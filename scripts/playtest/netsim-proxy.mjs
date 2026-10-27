#!/usr/bin/env node
/**
 * WebSocket network-conditions proxy for playtesting.
 *
 *   node scripts/playtest/netsim-proxy.mjs --listen 8210 --target ws://localhost:8110 \
 *        --latency 60 --jitter 20 --loss 0.02 --bw 0 --spike-every 0 --spike-ms 0
 *
 * Point the client at ws://localhost:<listen> (VITE_WS_URL) instead of the
 * real server. Query string (?clientId=...) is forwarded untouched.
 *
 * Each direction (client->server, server->client) gets its own ordered
 * queue, because WebSocket rides TCP and TCP never reorders:
 *   latency  ms one-way delay added to every frame (so RTT += 2*latency)
 *   jitter   ms of extra uniform random delay per frame (ordering preserved,
 *            so jitter shows up as bunching, exactly like real TCP)
 *   loss     probability a frame "gets lost" -> modeled as a TCP retransmit:
 *            that frame AND everything queued behind it stall ~RTO (200ms+)
 *   bw       kbit/s cap per direction (0 = unlimited); frames serialize
 *   spikeEvery / spikeMs: every N seconds freeze the link for M ms (wifi hiccup)
 *   dropAfter  seconds after connect to hard-kill the socket (0 = never),
 *              tests reconnect paths
 *
 * Live reconfigure (applies to new frames immediately):
 *   curl "http://localhost:8210/config?latency=150&jitter=40&loss=0.05"
 *   curl  http://localhost:8210/config            -> current config JSON
 *   curl  http://localhost:8210/stats             -> per-direction byte/frame counts
 *   curl "http://localhost:8210/kill"             -> hard-close every proxied socket
 */
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : (process.env[`NETSIM_${name.toUpperCase().replace(/-/g, '_')}`] ?? def);
};

const LISTEN = parseInt(arg('listen', '8210'), 10);
const TARGET = arg('target', 'ws://localhost:8080');
const config = {
  latency: parseFloat(arg('latency', '0')),
  jitter: parseFloat(arg('jitter', '0')),
  loss: parseFloat(arg('loss', '0')),
  bw: parseFloat(arg('bw', '0')),
  spikeEvery: parseFloat(arg('spike-every', '0')),
  spikeMs: parseFloat(arg('spike-ms', '0')),
  dropAfter: parseFloat(arg('drop-after', '0')),
};
const stats = { c2s: { frames: 0, bytes: 0 }, s2c: { frames: 0, bytes: 0 }, connections: 0, open: 0 };
const sockets = new Set();

function spikeHoldUntil(now) {
  if (!config.spikeEvery || !config.spikeMs) return 0;
  const period = config.spikeEvery * 1000;
  const phase = now % period;
  return phase < config.spikeMs ? now - phase + config.spikeMs : 0;
}

/** Ordered delayed pipe: frames leave in arrival order, never earlier than their release time. */
function makePipe(dest, dirStats) {
  let lastRelease = 0;
  const fifo = [];
  let timer = null;
  return (data, isBinary) => {
    const now = Date.now();
    const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
    dirStats.frames++;
    dirStats.bytes += size;
    let release = now + config.latency + Math.random() * config.jitter;
    if (config.loss > 0 && Math.random() < config.loss) release += 200 + Math.random() * 100;
    const spike = spikeHoldUntil(now);
    if (spike) release = Math.max(release, spike + config.latency);
    if (config.bw > 0) {
      const txMs = (size * 8) / config.bw; // kbit/s -> bits per ms
      release = Math.max(release, lastRelease + txMs);
    }
    release = Math.max(release, lastRelease); // TCP: no reordering
    lastRelease = release;
    // One FIFO + one timer per pipe: independent setTimeouts with equal
    // release times can fire out of order (1ms timer granularity), which the
    // game server then sees as stale/dropped input seqs. Real TCP never does.
    fifo.push([release, data, isBinary]);
    if (!timer) pump();
  };
  function pump() {
    timer = null;
    const now = Date.now();
    while (fifo.length && fifo[0][0] <= now) {
      const [, d, b] = fifo.shift();
      if (dest.readyState === WebSocket.OPEN) dest.send(d, { binary: b });
    }
    if (fifo.length) timer = setTimeout(pump, Math.max(1, fifo[0][0] - Date.now()));
  }
}

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/config') {
    for (const [k, v] of url.searchParams) if (k in config) config[k] = parseFloat(v);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(config));
    console.log('[netsim] config', JSON.stringify(config));
  } else if (url.pathname === '/stats') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(stats));
  } else if (url.pathname === '/kill') {
    for (const s of sockets) s.terminate();
    res.end(`killed ${sockets.size}\n`);
  } else {
    res.statusCode = 404;
    res.end('netsim proxy: /config /stats /kill\n');
  }
});

const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', (client, req) => {
  stats.connections++;
  stats.open++;
  const upstream = new WebSocket(TARGET + (req.url?.startsWith('/') ? req.url.slice(1) : req.url ?? ''));
  sockets.add(client);
  const pending = [];
  const toServer = makePipe(upstream, stats.c2s);
  const toClient = makePipe(client, stats.s2c);

  client.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) toServer(data, isBinary);
    else pending.push([data, isBinary]);
  });
  upstream.on('open', () => { for (const [d, b] of pending.splice(0)) toServer(d, b); });
  upstream.on('message', (data, isBinary) => toClient(isBinary ? data : data.toString(), isBinary));

  let dropTimer = null;
  if (config.dropAfter > 0) dropTimer = setTimeout(() => client.terminate(), config.dropAfter * 1000);

  const closeBoth = () => {
    if (dropTimer) clearTimeout(dropTimer);
    sockets.delete(client);
    stats.open = sockets.size;
    // Delay the close by the link latency so it can't overtake queued frames.
    setTimeout(() => {
      try { client.close(); } catch { /* gone */ }
      try { upstream.close(); } catch { /* gone */ }
    }, config.latency + config.jitter);
  };
  client.on('close', closeBoth);
  upstream.on('close', closeBoth);
  client.on('error', () => {});
  upstream.on('error', () => closeBoth());
});

httpServer.listen(LISTEN, () => {
  console.log(`[netsim] ws://localhost:${LISTEN} -> ${TARGET}`, JSON.stringify(config));
});
