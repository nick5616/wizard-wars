#!/usr/bin/env node
/**
 * Headless WebSocket soak / fuzz harness for the authoritative server.
 *
 *   node scripts/playtest/soak.mjs --url ws://localhost:8160 --clients 16 --duration 120 --seed 1
 *   node scripts/playtest/soak.mjs --spawn --port 8160 --clients 32 --duration 300 --rooms 4 --matches 0.25
 *   node scripts/playtest/soak.mjs --url ws://localhost:8260 --clients 16 --fuzz 0.25 --kill-url http://localhost:8260/kill --kill-every 15
 *
 * Every simulated client speaks the real wire protocol: a random UUID
 * clientId on the URL, ROOM_JOINED handshake, JOIN_ROOM / SELECT_CLASS /
 * (debug) grant, then ~64Hz PLAYER_INPUT frames in exactly the shape
 * CameraController.tsx sends (seq, ts = serverNow, flags, yaw, pitch, cast,
 * mobility, defensive, basicAttack, melee, activeSlot). Behavior: walk and
 * jump, aim at the nearest enemy, cycle through every equipped spell, use
 * mobility/defensive/RMB/F, answer skill votes, buy/equip, respawn, spawn and
 * despawn bots, reconnect with the same clientId, switch rooms, run
 * single-player matches in every mode. A fraction of clients (--fuzz) instead
 * send malformed / hostile traffic.
 *
 * Invariants checked on every parsed GAME_TICK and event (see `viol()`):
 *   finite positions/health/mana, health in [0,maxHealth], inside the arena,
 *   above terrain, dead players don't move or get cast confirmations,
 *   at most one live domain, cooldowns not undercut (non-debug clients, clean
 *   network only), no teamkills, MATCH_END exactly once per match, tick
 *   counter monotonic. With --spawn the server's stdout/stderr is also
 *   scanned for "Tick error", "Bad message", uncaught exceptions, and its
 *   [stats] lines (WW_STATS=1) produce tick-duration / heap / leak numbers.
 *
 * Flags (defaults in brackets):
 *   --url ws://localhost:8160   server (or netsim proxy) to hit
 *   --spawn [--port 8160] [--server server/index.js]  start the server ourselves (WW_STATS=1) and watch its logs
 *   --clients 16  --duration 120  --seed 1
 *   --rooms 1            spread non-match clients over lobby + (rooms-1) named arenas
 *   --fuzz 0             fraction of clients that are hostile fuzzers
 *   --matches 0          fraction of clients running single-player matches (all modes)
 *   --churn 2            average voluntary disconnect+reconnect per client per minute
 *   --debug 0.5          fraction of clients that DEBUG_GRANT (cooldown-free, all spells)
 *   --botops 0.15        fraction of clients that spawn/despawn bots in their room
 *   --kill-url URL --kill-every 15   hit a netsim proxy /kill periodically (reconnect storm)
 *   --parse-every 3      fully parse/validate every Nth GAME_TICK per client (cuts harness CPU)
 *   --remote             you are connecting via a non-loopback address (e.g. the LAN IP): the server must refuse DEBUG_GRANT, so debug clients are cooldown-checked too
 *   --lagged             skip cooldown-undercut checks (use when going through a lagging proxy)
 *   --idle-wait 4        seconds to wait after all clients leave to verify cleanup (--spawn only)
 *   --json out.json      also write the full report as JSON
 *   --server-log f.txt   (--spawn) save the server's complete stdout/stderr
 * Exit code is 1 if any invariant was violated.
 */
import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import { writeFileSync, createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { C2S, S2C } = await import('../../shared/events.js');
const { CLASSES, ARENA_RADIUS, PLAYER_HEIGHT } = await import('../../shared/constants.js');
const { terrainHeightAt } = await import('../../shared/mapLayout.js');
const { SKILL_TREES } = await import('../../shared/skillTrees.js');
const { GAME_MODE_ORDER } = await import('../../shared/gameModes.js');
const { DUEL_OPPONENTS } = await import('../../shared/duelOpponents.js');
const { getSpell, BASIC_ATTACK, MELEE_ATTACK } = await import('../../shared/spells.js');

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const num = (n, d) => parseFloat(arg(n, d));
const OPT = {
  url: arg('url', null),
  spawn: has('spawn'),
  serverEntry: arg('server', 'server/index.js'),
  port: num('port', 8160),
  clients: num('clients', 16),
  duration: num('duration', 120),
  seed: num('seed', 1),
  rooms: Math.max(1, num('rooms', 1)),
  fuzz: num('fuzz', 0),
  fuzzSim: has('fuzz-sim'),
  matches: num('matches', 0),
  churn: num('churn', 2),
  debug: num('debug', 0.5),
  botops: num('botops', 0.15),
  killUrl: arg('kill-url', null),
  killEvery: num('kill-every', 15),
  parseEvery: Math.max(1, num('parse-every', 3)),
  lagged: has('lagged'),
  remote: has('remote'),
  idleWait: num('idle-wait', 4),
  json: arg('json', null),
  serverLog: arg('server-log', null),
  quiet: has('quiet'),
};
if (!OPT.url) OPT.url = `ws://localhost:${OPT.port}`;

// mulberry32: tiny seeded PRNG so a failing run can be replayed with the same --seed
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(OPT.seed);
const rand = (a, b) => a + rng() * (b - a);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const chance = (p) => rng() < p;
const seededUuid = () => {
  const h = Array.from({ length: 32 }, () => Math.floor(rng() * 16).toString(16));
  h[12] = '4'; h[16] = '89ab'[Math.floor(rng() * 4)];
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};
const log = (...a) => { if (!OPT.quiet) console.log(...a); };

// ── invariant bookkeeping ───────────────────────────────────────────────────
const violations = new Map(); // name -> { count, samples[] }
function viol(name, detail) {
  let v = violations.get(name);
  if (!v) violations.set(name, (v = { count: 0, samples: [] }));
  v.count++;
  if (v.samples.length < 3) v.samples.push(detail);
}
const counters = { ticksParsed: 0, ticksSeen: 0, bytesIn: 0, msgsOut: 0, connects: 0, reconnects: 0, closes: 0, errors: 0, hostileSent: 0, casts: 0, castDenied: 0, hits: 0, kills: 0, matchesStarted: 0, matchesEnded: 0, respawns: 0, matchEndsDuplicate: 0, reorderedTicks: 0 };
const serverSpacing = []; // ms between consecutive server tick timestamps, from one observer per room
const recvGaps = []; // ms between GAME_TICK arrivals as observed by clients
// Any player cold field (Player/Bot coldDelta) in a delta tick: that tick must be parsed, see onMessage.
const COLD_FIELD_RE = /"(?:username|class|team|maxHealth|maxMana|equippedSpells|level|kills|elo|ping|isBot|phantomCasts|behavior|autoEquipOnLevel)":/;
const tickBytes = [];
const pctOf = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2); };
const maxOf = (arr) => { let m = 0; for (const x of arr) if (x > m) m = x; return +m.toFixed(2); };

// ── server process (optional) ───────────────────────────────────────────────
const serverLog = { badMessage: 0, tickError: 0, uncaught: 0, wsError: 0, other: [], stats: [], exited: null };
let serverProc = null;
function startServer() {
  serverProc = spawn(process.execPath, [OPT.serverEntry], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(OPT.port), REDIS_URL: 'redis://127.0.0.1:1', WW_STATS: '1', WW_STATS_MS: '5000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logFile = OPT.serverLog ? createWriteStream(OPT.serverLog) : null;
  const onLine = (line, isErr) => {
    if (logFile && !line.startsWith('[stats] ')) logFile.write(`${line}
`);
    if (line.startsWith('[stats] ')) { try { serverLog.stats.push(JSON.parse(line.slice(8))); } catch { /* partial */ } return; }
    if (line.includes('Tick error')) { serverLog.tickError++; if (serverLog.other.length < 8) serverLog.other.push(line); }
    else if (line.includes('Bad message')) { serverLog.badMessage++; if (serverLog.other.length < 8) serverLog.other.push(line); }
    else if (/uncaught|unhandled|TypeError|RangeError|ReferenceError/i.test(line)) { serverLog.uncaught++; if (serverLog.other.length < 8) serverLog.other.push(line); }
    else if (line.includes('WS error')) serverLog.wsError++;
    else if (isErr && !/ECONNREFUSED|redis/i.test(line) && serverLog.other.length < 8 && line.trim()) serverLog.other.push(line);
  };
  for (const [stream, isErr] of [[serverProc.stdout, false], [serverProc.stderr, true]]) {
    let buf = '';
    stream.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i), isErr); buf = buf.slice(i + 1); } });
  }
  serverProc.on('exit', (code, sig) => { if (!serverProc.stoppedByHarness) serverLog.exited = { code, sig }; }); // only an UNEXPECTED exit is a crash
  return new Promise((resolve) => setTimeout(resolve, 1500));
}

// ── hostile payloads ────────────────────────────────────────────────────────
const BIG = 'A'.repeat(300000);
const HUGE = 'B'.repeat(2 * 1024 * 1024);
// Raw JSON text, because JSON.stringify can't produce Infinity (1e999 parses to it).
function hostileFrames(c) {
  const t = (x) => `"${x}"`;
  const spell = pick(c.equipped.filter(Boolean).length ? c.equipped.filter(Boolean) : ['fireball']);
  const wild = pick(['1e999', '-1e999', '1e308', '-1e308', '0', 'null', '"x"', '[]', '{}', 'true', '1e-999', '9007199254740993', '-0']);
  const aim = () => `{"x":${pick(['1e999', '-1e999', 'null', '1e308', '0', '0.5', '"a"'])},"y":${pick(['1e999', 'null', '0', '-1e308', '0.1'])},"z":${pick(['1e999', '0', '1e308', 'null', '-1'])}}`;
  const base = (extra) => `{"type":"${C2S.PLAYER_INPUT}","seq":${c.seq + 1},"ts":${Date.now()},"flags":0,"yaw":0,"pitch":0${extra}}`;
  const out = [
    // wrong shapes
    'null', '[]', '1', '"str"', '{}', '{"type":null}', '{"type":123}', '{"type":{"a":1}}', 'not json {{{', '', '{"type":"c2s:player_input"', '{"__proto__":{"isDebugMode":true},"type":"c2s:player_input"}',
    `{"type":"${C2S.PLAYER_INPUT}"}`,
    `{"type":"${C2S.PLAYER_INPUT}","seq":${wild},"ts":${wild},"flags":${wild},"yaw":${wild},"pitch":${wild}}`,
    `{"type":"${C2S.PLAYER_INPUT}","seq":"1","flags":"3","yaw":"9"}`,
    base(`,"cast":{"spellId":"${spell}","slotIndex":0,"aimDir":${aim()}}`),
    base(`,"cast":{"spellId":"${spell}","slotIndex":${wild},"aimDir":${aim()}}`),
    base(`,"cast":{"spellId":${wild},"slotIndex":0}`),
    base(`,"cast":{"spellId":"nope","slotIndex":99,"aimDir":{"x":1,"y":0,"z":0}}`),
    base(`,"cast":{"spellId":"__proto__","slotIndex":"__proto__"}`),
    base(`,"cast":{"spellId":"constructor","slotIndex":"constructor"}`),
    base(`,"cast":5`), base(`,"cast":"fireball"`), base(`,"cast":[]`),
    base(`,"cast":{"spellId":"${spell}","slotIndex":${c.slot},"aimDir":{"x":0,"y":0,"z":0},"targetId":${wild}}`),
    base(`,"cast":{"spellId":"${spell}","slotIndex":${c.slot},"aimDir":{"x":1e5,"y":1e5,"z":1e5}}`),
    base(`,"cast":{"spellId":"${spell}","slotIndex":${c.slot}}`),
    base(`,"basicAttack":{"aimDir":${aim()}}`), base(`,"basicAttack":{}`), base(`,"basicAttack":true`),
    base(`,"melee":{"aimDir":${aim()}}`), base(`,"melee":{}`), base(`,"melee":1`),
    base(`,"mobility":true,"flags":${wild}`), base(`,"defensive":true`),
    base(`,"activeSlot":${wild}`), base(`,"activeSlot":"x"`),
    // duplicate / backwards seq, rapid-fire duplicate casts
    `{"type":"${C2S.PLAYER_INPUT}","seq":${Math.max(0, c.seq - 1000)},"ts":0,"flags":1,"yaw":0,"pitch":0}`,
    `{"type":"${C2S.PLAYER_INPUT}","seq":-5,"ts":-1,"flags":-1,"yaw":0,"pitch":0}`,
    // other message types
    `{"type":"${C2S.JOIN_ROOM}","roomId":${wild},"username":${wild}}`,
    `{"type":"${C2S.JOIN_ROOM}","roomId":"${'r'.repeat(5000)}","username":"${BIG.slice(0, 5000)}"}`,
    `{"type":"${C2S.JOIN_ROOM}","roomId":"experiment-${randomUUID()}","experiment":true}`,
    `{"type":"${C2S.JOIN_ROOM}","roomId":"match-${randomUUID()}"}`,
    `{"type":"${C2S.JOIN_ROOM}","roomId":"../../etc/passwd","username":"<script>alert(1)</script>"}`,
    `{"type":"${C2S.SELECT_CLASS}","class":${wild}}`, `{"type":"${C2S.SELECT_CLASS}","class":"fire","username":${wild}}`,
    `{"type":"${C2S.EQUIP_SPELL}","slotIndex":${wild},"spellId":${wild}}`, `{"type":"${C2S.EQUIP_SPELL}","slotIndex":-1,"spellId":null}`,
    `{"type":"${C2S.EQUIP_SPELL}","slotIndex":"0","spellId":"${spell}"}`, `{"type":"${C2S.EQUIP_SPELL}","slotIndex":0.5,"spellId":"${spell}"}`,
    `{"type":"${C2S.EQUIP_SPELL}","slotIndex":1e999,"spellId":"${spell}"}`,
    `{"type":"${C2S.BUY_SKILL_NODE}","nodeId":${wild}}`, `{"type":"${C2S.BUY_SKILL_NODE}","nodeId":"${BIG.slice(0, 100000)}"}`, `{"type":"${C2S.BUY_SKILL_NODE}","nodeId":"__proto__"}`,
    `{"type":"${C2S.REVEAL_LORE}","nodeId":${wild}}`,
    `{"type":"${C2S.RESPAWN}","newClass":${wild},"switchBranch":${wild}}`, `{"type":"${C2S.RESPAWN}","newClass":"fire"}`, `{"type":"${C2S.RESPAWN}"}`,
    `{"type":"${C2S.SKILL_VOTE_RESOLVE}","promptId":${wild},"choice":${wild}}`,
    `{"type":"${C2S.DEBUG_SET_BRANCH}","class":"fire","branch":${wild}}`, `{"type":"${C2S.DEBUG_SET_BRANCH}","class":${wild},"branch":"x"}`,
    `{"type":"${C2S.START_MATCH}","mode":${wild},"class":${wild}}`, `{"type":"${C2S.START_MATCH}","mode":"constructor","class":"fire"}`, `{"type":"${C2S.START_MATCH}","mode":"__proto__","class":"fire"}`,
    `{"type":"${C2S.START_MATCH}","mode":"duel1v1","class":"fire","opponentId":${wild}}`,
    `{"type":"${C2S.CLOCK_SYNC}","t1":${wild}}`, `{"type":"${C2S.CLOCK_SYNC}"}`,
    `{"type":"${C2S.SPAWN_BOT}","class":${wild},"behavior":${wild},"loadout":${wild},"position":${wild}}`,
    `{"type":"${C2S.SPAWN_BOT}","class":"fire","position":{"x":1e999,"y":null,"z":"a"},"loadout":[1,2,3,4]}`,
    `{"type":"${C2S.DESPAWN_BOT}","botId":${wild}}`, `{"type":"${C2S.SET_BOT_LOADOUT}","botId":${wild},"equippedSpells":${wild}}`,
    `{"type":"${C2S.RUN_SIMULATION}","matchup":${wild},"rounds":${wild}}`,
    `{"type":"${C2S.SAVE_CARD_RECIPES}","bank":${wild},"assignments":${wild}}`,
    `{"type":"${C2S.LEAVE_ROOM}"}`, `{"type":"${C2S.SPAWN_BOTS}"}`, `{"type":"${C2S.DESPAWN_BOTS}"}`,
    `{"type":"${t(BIG.slice(0, 100000))}"}`,
  ];
  // rare giant frames (server must drop, not buffer 100MB)
  // A VALID simulation request spins up worker threads (3 at a time) running up to 500 rounds each: real lab load, not a protocol test, so opt-in.
  if (OPT.fuzzSim) out.push(`{"type":"${C2S.RUN_SIMULATION}","matchup":[{"class":"fire"},{"class":"ice"}],"rounds":1e999}`);
  if (chance(0.01)) out.push(`{"type":"${C2S.JOIN_ROOM}","username":"${HUGE}"}`);
  if (chance(0.02)) out.push(`{"type":"${C2S.JOIN_ROOM}","username":"${BIG}"}`);
  return out;
}

// ── simulated client ────────────────────────────────────────────────────────
const HAS_PROXY_LAG = OPT.lagged;
class Client {
  constructor(idx, kind) {
    this.idx = idx;
    this.kind = kind; // 'normal' | 'fuzz' | 'match'
    this.id = seededUuid();
    this.ws = null;
    this.open = false;
    this.seq = 0;
    this.yaw = rand(-Math.PI, Math.PI);
    this.pitch = 0;
    this.flags = 0;
    this.nextFlagChange = 0;
    this.nextInputAt = 0;
    this.nextCastAt = 0;
    this.nextActionAt = 0;
    this.offset = 0; // clock sync
    this.offsets = [];
    this.cls = pick(CLASSES);
    this.debug = chance(OPT.debug) && kind !== 'fuzz-nodebug';
    this.botops = chance(OPT.botops);
    this.roomName = OPT.rooms > 1 && idx % OPT.rooms !== 0 ? `arena-${idx % OPT.rooms}` : 'lobby';
    this.inMatch = false;
    this.matchEnds = 0;
    this.equipped = [];
    this.slot = 0;
    this.tick = null; // last parsed tick
    this.prevTick = null;
    this.me = null;
    this.tickCount = 0;
    this.lastRecvAt = 0;
    this.lastServerTs = 0;
    this.lastTickNo = -1;
    this.deadTicks = 0;
    this.isObserver = false;
    this.castLog = new Map(); // spellId -> last confirmed cast time
    this.respawnEvents = new Map(); // playerId -> PLAYER_RESPAWNED count (a respawn between two sampled ticks explains a position jump)
    this.respawnAtPrevTick = new Map();
    this.pendingVote = null;
    this.reconnectAt = 0;
    this.nextChurnAt = 0;
    this.nextMatchAt = 0;
    this.joined = false;
    this.nextKillCheck = 0;
    this.stopped = false;
  }

  connect() {
    if (this.stopped) return;
    const ws = new WebSocket(`${OPT.url}?clientId=${this.id}`, { perMessageDeflate: false });
    this.ws = ws;
    ws.on('open', () => {
      this.open = true;
      counters.connects++;
      this.connNo = (this.connNo ?? 0) + 1;
      this.tick = this.prevTick = this.me = null; // events/ticks were missed while offline: don't diff across the gap
      this.castLog.clear(); // a reconnect is a brand-new server-side Player: cooldowns start fresh
      this.seq = 0;
      this.joined = false;
      this.inMatch = false;
      this.send(C2S.CLOCK_SYNC, { t1: Date.now() });
      this.clockTimer = setInterval(() => this.send(C2S.CLOCK_SYNC, { t1: Date.now() }), 5000);
    });
    // A graceful close() through a laggy proxy can leave the OLD socket delivering frames after the new one is up; those belong to a dead session.
    ws.on('message', (data, isBinary) => { if (ws === this.ws) this.onMessage(data, isBinary); });
    ws.on('close', () => {
      this.open = false;
      counters.closes++;
      clearInterval(this.clockTimer);
      if (!this.stopped) {
        counters.reconnects++;
        this.reconnectAt = Date.now() + rand(200, 1500);
      }
    });
    ws.on('error', () => { counters.errors++; });
  }

  send(type, payload = {}) {
    if (!this.open || this.ws.readyState !== WebSocket.OPEN) return;
    counters.msgsOut++;
    this.ws.send(JSON.stringify({ type, ...payload }));
  }
  sendRaw(text) {
    if (!this.open || this.ws.readyState !== WebSocket.OPEN) return;
    counters.msgsOut++;
    counters.hostileSent++;
    this.ws.send(text);
  }

  serverNow() { return Date.now() + this.offset; }

  onMessage(data, isBinary) {
    const raw = isBinary ? null : data.toString();
    if (raw === null) return;
    counters.bytesIn += raw.length;

    // Cheap path for the hot message: GAME_TICK header only, full parse every Nth.
    if (raw.startsWith('{"type":"s2c:game_tick"')) {
      counters.ticksSeen++;
      const m = /^\{"type":"s2c:game_tick",(?:"delta":true,)?"tick":(\d+),"timestamp":(\d+)/.exec(raw);
      const nowMs = performance.now();
      if (this.lastRecvAt) recvGaps.push(nowMs - this.lastRecvAt);
      this.lastRecvAt = nowMs;
      if (m) {
        const tickNo = +m[1], ts = +m[2];
        if (this.lastTickNo >= 0 && tickNo <= this.lastTickNo && this.joinedRoomTick === this.roomKey && HAS_PROXY_LAG) counters.reorderedTicks++; // netsim-proxy can reorder frames under heavy load (see report); not a server fault
        else if (this.lastTickNo >= 0 && tickNo <= this.lastTickNo && this.joinedRoomTick === this.roomKey) viol('tick_not_monotonic', `client ${this.idx} conn #${this.connNo} room ${this.roomKey}: ${this.lastTickNo} -> ${tickNo} (ts ${this.lastServerTs} -> ${ts})`);
        if (this.isObserver && this.lastServerTs && tickNo === this.lastTickNo + 1) serverSpacing.push(ts - this.lastServerTs);
        this.lastTickNo = tickNo; this.lastServerTs = ts; this.lastTickTs = ts;
        this.joinedRoomTick = this.roomKey;
      }
      if (this.isObserver) tickBytes.push(raw.length);
      // Delta ticks carry a player's cold fields (maxHealth, username, loadout...)
      // only on the tick they change -- never skip one of those, or the merged
      // view in onTick would be missing them for the rest of the session.
      if (++this.tickCount % OPT.parseEvery === 0 || COLD_FIELD_RE.test(raw)) {
        try { this.onTick(JSON.parse(raw)); } catch (e) { viol('tick_unparseable', e.message); }
      }
      return;
    }

    let msg;
    try { msg = JSON.parse(raw); } catch { viol('server_sent_bad_json', raw.slice(0, 80)); return; }
    this.onEvent(msg);
  }

  onEvent(msg) {
    (this.recent ??= []).push(`${msg.type.slice(4)}${msg.spellId ? ':' + msg.spellId : ''}@${this.lastTickTs % 100000}/${(performance.now() % 100000).toFixed(0)}`);
    if (this.recent.length > 14) this.recent.shift();
    switch (msg.type) {
      case S2C.CLOCK_SYNC: {
        const t4 = Date.now();
        const off = ((msg.t2 - msg.t1) + (msg.t3 - t4)) / 2;
        if (Number.isFinite(off)) {
          this.offsets.push(off);
          if (this.offsets.length > 8) this.offsets.shift();
          this.offset = [...this.offsets].sort((a, b) => a - b)[Math.floor(this.offsets.length / 2)];
        }
        break;
      }
      case S2C.ROOM_JOINED:
        if (msg.playerId !== this.id) viol('room_joined_wrong_id', `${msg.playerId} != ${this.id}`);
        this.nextActionAt = Date.now() + 50;
        this.startSession();
        break;
      case S2C.ROOM_STATE:
        this.roomKey = msg.roomId;
        this.parsedTick = -1;
        this.lastTickNo = -1;
        this.lastServerTs = 0;
        this.merged = Object.fromEntries(Object.entries(msg.players ?? {}).map(([id, p]) => [id, { ...p }]));
        this.checkPlayers(msg.players, 'room_state');
        break;
      case S2C.SPELL_CAST: {
        counters.casts++;
        if (this.me && !this.me.isAlive && this.deadTicks >= 3) viol('cast_confirmed_while_dead', `${msg.spellId} dead for ${this.deadTicks} ticks`);
        // Two clocks, flag only when BOTH say "too soon": arrival time (performance.now) is
        // compressed by a harness stall that delivers a backlog at once, tick time (timestamp of
        // the latest tick before this event) is compressed by a SERVER stall (it handles sockets
        // before it runs the overdue tick, so the event outruns the tick clock). A real
        // cooldown bypass shrinks both.
        const now = this.lastTickTs;
        const arrival = performance.now();
        const last = this.castLog.get(msg.spellId);
        if (last && now && (!this.debug || OPT.remote) && msg.cooldownMs > 0) {
          if (now - last.at < last.cd - 100 && arrival - last.arrival < last.cd - 100) viol('cooldown_undercut', `${msg.spellId}: ${(now - last.at).toFixed(0)}ms < cd ${last.cd}ms (client ${this.idx} ${this.kind}, room ${this.roomKey}, prev in room ${last.room}, conn #${this.connNo} vs #${last.conn}, matches ${counters.matchesStarted}) recent=${this.recent.join(' ')}`);
        }
        this.castLog.set(msg.spellId, { at: now, arrival, cd: msg.cooldownMs ?? 0, room: this.roomKey, conn: this.connNo });
        break;
      }
      case S2C.SPELL_CAST_DENIED: counters.castDenied++; break;
      case S2C.HIT_CONFIRMED:
        counters.hits++;
        if (!Number.isFinite(msg.damage) || msg.damage < 0) viol('bad_hit_damage', JSON.stringify(msg));
        break;
      case S2C.PLAYER_DIED: {
        counters.kills++;
        if (msg.killerId && msg.killerId === msg.playerId) viol('self_kill_credited', JSON.stringify(msg));
        const pv = this.tick?.players;
        if (pv && msg.killerId && msg.killerId !== msg.playerId) {
          const k = pv[msg.killerId], v = pv[msg.playerId];
          if (k && v && k.team != null && k.team === v.team) viol('teamkill', `${k.username}(t${k.team}) killed ${v.username}`);
        }
        break;
      }
      case S2C.PLAYER_RESPAWNED:
        this.respawnEvents.set(msg.playerId, (this.respawnEvents.get(msg.playerId) ?? 0) + 1);
        if (msg.playerId === this.id) { counters.respawns++; this.deadTicks = 0; if (this.me) this.me.isAlive = true; }
        if (!msg.position || ![msg.position.x, msg.position.y, msg.position.z].every(Number.isFinite)) viol('respawn_bad_position', JSON.stringify(msg.position));
        break;
      case S2C.MATCH_END:
        counters.matchesEnded++;
        this.matchEnds++;
        if (this.matchEnds > 1) { counters.matchEndsDuplicate++; viol('match_end_more_than_once', `client ${this.idx} got ${this.matchEnds}`); }
        this.nextMatchAt = Date.now() + rand(1500, 6000);
        break;
      case S2C.SKILL_VOTE_PROMPT:
        this.pendingVote = { promptId: msg.promptId, options: msg.options.map((o) => o.id), at: Date.now() + rand(150, 2500), blocking: msg.blocking };
        break;
      case S2C.ERROR: break;
      default: break;
    }
  }

  checkPlayers(players, where) {
    if (!players) return;
    for (const [id, p] of Object.entries(players)) {
      const pos = p.position;
      if (!pos || ![pos.x, pos.y, pos.z].every((n) => typeof n === 'number' && Number.isFinite(n))) { viol('nonfinite_position', `${where} ${p.username} ${JSON.stringify(pos)}`); continue; }
      if (![p.health, p.maxHealth, p.mana, p.yaw, p.pitch].every((n) => typeof n === 'number' && Number.isFinite(n))) viol('nonfinite_stat', `${where} ${p.username} h=${p.health} mh=${p.maxHealth} m=${p.mana} yaw=${p.yaw}`);
      if (p.health < 0 || p.health > p.maxHealth) viol('health_out_of_range', `${p.username} ${p.health}/${p.maxHealth}`);
      if (p.mana < 0 || p.mana > p.maxMana + 1) viol('mana_out_of_range', `${p.username} ${p.mana}/${p.maxMana}`);
      if (p.isAlive && p.health <= 0) viol('alive_with_zero_health', p.username);
      if (p.isAlive) {
        const r = Math.hypot(pos.x, pos.z);
        if (r > ARENA_RADIUS + 0.5) viol('outside_arena', `${p.username} r=${r.toFixed(2)}`);
        const floor = terrainHeightAt(pos.x, pos.z) + PLAYER_HEIGHT;
        if (pos.y < floor - 0.25) viol('below_terrain', `${p.username} y=${pos.y.toFixed(2)} floor=${floor.toFixed(2)}`);
        if (pos.y > 200) viol('absurd_height', `${p.username} y=${pos.y}`);
      }
      const prev = this.prevTick?.players?.[id];
      if (prev && prev.isAlive && !p.isAlive && p.class && p.health > 0) viol('dead_with_health', `${p.username} ${p.health}`);
      // `class` guards against a fresh Player (reconnect, same id) that legitimately sits unspawned at the origin.
      if (prev && !prev.isAlive && !p.isAlive && where === 'tick' && prev.class && p.class === prev.class && this.respawnAtPrevTick.get(id) === (this.respawnEvents.get(id) ?? 0)) {
        if (Math.abs(prev.position.x - pos.x) > 1e-6 || Math.abs(prev.position.z - pos.z) > 1e-6) viol('dead_player_moved', `${p.username} tick ${this.prevTick.tick}->${this.tick?.tick ?? '?'} (${prev.position.x.toFixed(2)},${prev.position.z.toFixed(2)}) -> (${pos.x.toFixed(2)},${pos.z.toFixed(2)})`);
      }
    }
  }

  onTick(t) {
    // Never diff a tick against a NEWER one that already arrived (transport reordering): drop it.
    if (this.parsedRoom === this.roomKey && t.tick <= this.parsedTick) return;
    this.parsedRoom = this.roomKey; this.parsedTick = t.tick;
    counters.ticksParsed++;
    // `delta: true` ticks (Room._broadcastTick) send hot fields every tick and
    // cold ones only on change: merge into a running per-player view, the same
    // way the client's applyTick does, so the checks below see whole players.
    if (t.delta) {
      const merged = (this.merged ??= {});
      for (const id in merged) if (!(id in t.players)) delete merged[id];
      for (const [id, p] of Object.entries(t.players)) {
        merged[id] = Object.assign(merged[id] ?? {}, { activeEffects: {}, defensiveActive: false, parryActive: false }, p);
      }
      t.players = Object.fromEntries(Object.entries(merged).map(([id, p]) => [id, { ...p }]));
    }
    this.prevTick = this.tick;
    this.tick = t;
    this.checkPlayers(t.players, 'tick');
    this.respawnAtPrevTick = new Map(this.respawnEvents);
    this.me = t.players?.[this.id] ?? null;
    if (this.me) {
      this.equipped = this.me.equippedSpells ?? [];
      this.deadTicks = this.me.isAlive ? 0 : this.deadTicks + 1;
    }
    for (const [id, pr] of Object.entries(t.projectiles ?? {})) {
      const p = pr.position, v = pr.velocity;
      if (![p.x, p.y, p.z, v.x, v.y, v.z].every(Number.isFinite)) viol('nonfinite_projectile', `${id} ${pr.spellId} ${JSON.stringify(p)} ${JSON.stringify(v)}`);
    }
    for (const [id, e] of Object.entries(t.effects ?? {})) {
      for (const k of ['position', 'origin']) {
        const p = e[k];
        if (p && ![p.x, p.z].every(Number.isFinite)) viol('nonfinite_effect', `${e.type} ${e.spellId} ${k} ${JSON.stringify(p)}`);
      }
      if (e.direction && !Object.values(e.direction).every((n) => typeof n === 'number' && Number.isFinite(n))) viol('nonfinite_effect_direction', `${e.type} ${e.spellId}`);
    }
    for (const b of Object.values(t.barriers ?? {})) {
      if (![b.position.x, b.position.y, b.position.z].every(Number.isFinite)) viol('nonfinite_barrier', JSON.stringify(b.position));
    }
    let liveDomains = 0;
    for (const d of Object.values(t.domains ?? {})) if (d.active && d.expiresAt > t.timestamp) liveDomains++;
    if (liveDomains > 1) viol('multiple_live_domains', `${liveDomains} at tick ${t.tick}`);
    const sizes = [Object.keys(t.projectiles ?? {}).length, Object.keys(t.effects ?? {}).length, Object.keys(t.barriers ?? {}).length, Object.keys(t.domains ?? {}).length];
    peak.projectiles = Math.max(peak.projectiles, sizes[0]); peak.effects = Math.max(peak.effects, sizes[1]);
    peak.barriers = Math.max(peak.barriers, sizes[2]); peak.domains = Math.max(peak.domains, sizes[3]);
  }

  // Joins the intended room / mode after ROOM_JOINED.
  startSession() {
    this.joined = true;
    this.matchEnds = 0;
    if (this.kind === 'match') { this.startMatch(); return; }
    this.send(C2S.JOIN_ROOM, { roomId: this.roomName, username: `Soak_${this.idx}` });
    this.send(C2S.SELECT_CLASS, { class: this.cls, username: `Soak_${this.idx}` });
    if (this.debug) this.send(C2S.DEBUG_GRANT);
  }

  startMatch() {
    const mode = pick(GAME_MODE_ORDER);
    this.cls = pick(CLASSES);
    this.matchEnds = 0;
    counters.matchesStarted++;
    this.send(C2S.START_MATCH, { mode, class: this.cls, username: `Soak_${this.idx}`, opponentId: mode === 'duel1v1' ? pick(DUEL_OPPONENTS).id : undefined });
    if (this.debug) this.send(C2S.DEBUG_GRANT);
    this.inMatch = true;
  }

  // One behavior step, called ~every ms by the global pump; self-paced.
  step(now) {
    if (this.stopped) return;
    if (!this.open) {
      if (this.reconnectAt && now >= this.reconnectAt) { this.reconnectAt = 0; this.connect(); }
      return;
    }
    if (!this.joined) return;

    // voluntary churn: drop the socket and come back with the same clientId
    if (OPT.churn > 0) {
      if (!this.nextChurnAt) this.nextChurnAt = now + rand(0.3, 1.7) * 60000 / OPT.churn;
      if (now >= this.nextChurnAt) {
        this.nextChurnAt = 0;
        if (chance(0.5)) this.ws.terminate(); else this.ws.close(1000);
        return;
      }
    }

    if (this.kind === 'fuzz') { this.fuzzStep(now); return; }

    // ── session-level actions ──────────────────────────────────────────────
    if (this.pendingVote && now >= this.pendingVote.at) {
      const v = this.pendingVote; this.pendingVote = null;
      if (chance(0.9)) this.send(C2S.SKILL_VOTE_RESOLVE, { promptId: v.promptId, choice: chance(0.9) ? pick(v.options) : 'bogus' });
    }

    if (now >= this.nextActionAt) {
      this.nextActionAt = now + rand(400, 2500);
      this.sessionAction(now);
    }

    if (now >= this.nextInputAt) {
      this.nextInputAt = this.nextInputAt ? Math.max(this.nextInputAt + 15.625, now - 100) : now;
      this.sendInput(now);
    }
  }

  sessionAction(now) {
    const me = this.me;
    const r = rng();
    if (me && !me.isAlive && this.joined && !this.inMatch) {
      if (chance(0.6)) {
        const msg = r < 0.15 ? { newClass: pick(CLASSES) } : r < 0.25 ? { switchBranch: true } : {};
        this.send(C2S.RESPAWN, msg);
        if (msg.newClass) this.cls = msg.newClass;
      }
      return;
    }
    if (this.kind === 'match' || this.inMatch) {
      if (this.matchEnds > 0 && now >= this.nextMatchAt) {
        // finished: either start another match, or go back to the lobby for a while
        if (chance(0.7)) { this.startMatch(); }
        else { this.send(C2S.LEAVE_ROOM); this.inMatch = false; this.kind = 'normal'; this.send(C2S.JOIN_ROOM, { roomId: 'lobby' }); this.send(C2S.SELECT_CLASS, { class: this.cls }); }
      } else if (me && !me.isAlive && this.matchEnds === 0 && chance(0.02)) {
        // sometimes bail out of a lost match early
        this.send(C2S.LEAVE_ROOM); this.inMatch = false; this.startMatch();
      }
      if (!this.inMatch) return;
    }
    if (r < 0.10) {
      const tree = SKILL_TREES[this.cls] ?? [];
      if (tree.length) this.send(C2S.BUY_SKILL_NODE, { nodeId: pick(tree).id });
    } else if (r < 0.16) {
      const tree = (SKILL_TREES[this.cls] ?? []).filter((n) => n.type === 'spell');
      if (tree.length) this.send(C2S.EQUIP_SPELL, { slotIndex: Math.floor(rng() * 10), spellId: chance(0.2) ? null : pick(tree).id });
    } else if (r < 0.20) {
      this.send(C2S.REVEAL_LORE, { nodeId: pick(SKILL_TREES[this.cls] ?? [{ id: 'x' }]).id });
    } else if (r < 0.26 && this.botops) {
      if (chance(0.5)) this.send(C2S.SPAWN_BOTS);
      else if (chance(0.5)) this.send(C2S.DESPAWN_BOTS);
      else { this.send(C2S.SPAWN_BOT, { class: pick(CLASSES), behavior: pick(['static', 'docile', 'aggressive']) }); }
    } else if (r < 0.29 && !this.inMatch && OPT.rooms > 1) {
      // switch rooms
      this.roomName = chance(0.3) ? 'lobby' : `arena-${1 + Math.floor(rng() * (OPT.rooms - 1))}`;
      this.send(C2S.JOIN_ROOM, { roomId: this.roomName });
      if (!this.me?.isAlive || chance(0.5)) this.send(C2S.SELECT_CLASS, { class: this.cls });
    } else if (r < 0.31 && !this.inMatch) {
      this.send(C2S.SELECT_CLASS, { class: (this.cls = pick(CLASSES)) });
    }
  }

  nearestEnemy() {
    const t = this.tick, me = this.me;
    if (!t || !me) return null;
    let best = null, bd = Infinity;
    for (const [id, p] of Object.entries(t.players)) {
      if (id === this.id || !p.isAlive) continue;
      if (me.team != null && p.team === me.team) continue;
      const d = Math.hypot(p.position.x - me.position.x, p.position.z - me.position.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { p: best, d: bd } : null;
  }

  sendInput(now) {
    const me = this.me;
    // walk: change key state every so often; sometimes strafe-jump
    if (now >= this.nextFlagChange) {
      this.nextFlagChange = now + rand(250, 1400);
      let f = 0;
      const m = rng();
      if (m < 0.55) f |= 1; else if (m < 0.65) f |= 2;
      if (chance(0.4)) f |= chance(0.5) ? 4 : 8;
      if (chance(0.25)) f |= 16;
      this.flags = f;
    }
    let jumpEdge = false;
    if ((this.flags & 16) && chance(0.03)) jumpEdge = true;
    const wantFlags = this.flags | (jumpEdge ? 64 : 0);

    // aim: turn toward the nearest enemy, else wander
    const en = this.nearestEnemy();
    let aimTo = this.yaw;
    if (en && me) {
      const dx = en.p.position.x - me.position.x, dz = en.p.position.z - me.position.z;
      aimTo = Math.atan2(-dx, -dz);
      const dy = (en.p.position.y - 0.9) - me.position.y;
      this.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(dy, en.d)));
    } else {
      aimTo = this.yaw + rand(-0.05, 0.05);
      this.pitch = 0;
    }
    let dyaw = aimTo - this.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.yaw += Math.max(-0.12, Math.min(0.12, dyaw));
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));

    const fwd = {
      x: -Math.sin(this.yaw) * Math.cos(this.pitch),
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * Math.cos(this.pitch),
    };

    let cast = null, mobility = false, defensive = false, basicAttack = null, melee = null;
    if (me && me.isAlive) {
      const alive = !me.isChoosingBranch;
      // cycle equipped spells; usually respect local cooldown knowledge, sometimes spam anyway
      if (alive && now >= this.nextCastAt) {
        this.nextCastAt = now + rand(60, 450);
        const slots = (me.equippedSpells ?? []).map((id, i) => [id, i]).filter(([id]) => id);
        if (slots.length) {
          this.slot = (this.slot + 1) % slots.length;
          const [spellId, slotIndex] = slots[this.slot];
          const cd = me.cooldowns?.[spellId] ?? 0;
          if (cd <= 0 || chance(0.15)) {
            cast = { spellId, slotIndex, aimDir: { ...fwd } };
            const def = getSpell(spellId);
            if (def?.requiresTarget && en) cast.targetId = en.p.id;
            else if (def?.requiresTarget && chance(0.5)) cast.targetId = this.id;
          }
        }
      }
      if (alive && chance(0.006)) mobility = true;
      if (alive && chance(0.004)) defensive = true;
      if (alive && chance(0.01) && BASIC_ATTACK[this.cls]) basicAttack = { aimDir: { ...fwd } };
      if (alive && chance(0.006) && MELEE_ATTACK[this.cls]) melee = { aimDir: { ...fwd } };
    }

    this.seq++;
    this.send(C2S.PLAYER_INPUT, {
      seq: this.seq,
      ts: this.serverNow(),
      flags: wantFlags,
      yaw: this.yaw,
      pitch: this.pitch,
      cast, mobility, defensive, basicAttack, melee,
      activeSlot: me?.activeSlot ?? 0,
    });
  }

  fuzzStep(now) {
    if (now >= this.nextInputAt) {
      this.nextInputAt = now + rand(2, 25);
      // keep a sane baseline so fuzz inputs land in a spawned player
      if (!this.me && this.tickCount === 0 && chance(0.05)) {
        this.send(C2S.JOIN_ROOM, { roomId: this.roomName });
        this.send(C2S.SELECT_CLASS, { class: this.cls });
        this.send(C2S.DEBUG_GRANT);
      }
      const frames = hostileFrames(this);
      const burst = chance(0.1) ? Math.floor(rand(10, 60)) : 1; // rapid-fire duplicates
      const f = pick(frames);
      for (let i = 0; i < burst; i++) this.sendRaw(f);
      if (chance(0.3)) { // interleave a well-formed input so the player stays in the world
        this.seq += 1 + Math.floor(rand(0, 3));
        const eq = this.equipped.filter(Boolean);
        const cs = eq.length ? { spellId: pick(eq), slotIndex: this.equipped.indexOf(pick(eq)), aimDir: { x: 0, y: 0, z: -1 } } : null;
        this.send(C2S.PLAYER_INPUT, { seq: this.seq, ts: this.serverNow(), flags: 1 | 16, yaw: rand(-3, 3), pitch: 0, cast: cs });
      }
      if (chance(0.0008)) this.sendRaw(Buffer.from([1, 2, 3, 4]));
      if (chance(0.01)) this.send(C2S.RESPAWN, {});
    }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.clockTimer);
    try { this.ws?.close(1000); } catch { /* */ }
  }
}

const peak = { projectiles: 0, effects: 0, barriers: 0, domains: 0 };

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  if (OPT.spawn) { log(`[soak] spawning server on port ${OPT.port}`); await startServer(); }

  const clients = [];
  const nFuzz = Math.round(OPT.clients * OPT.fuzz);
  const nMatch = Math.round(OPT.clients * OPT.matches);
  for (let i = 0; i < OPT.clients; i++) {
    const kind = i < nFuzz ? 'fuzz' : i < nFuzz + nMatch ? 'match' : 'normal';
    const c = new Client(i, kind);
    clients.push(c);
  }
  // one tick-spacing observer per room name
  const seenRooms = new Set();
  for (const c of clients) if (c.kind === 'normal' && !seenRooms.has(c.roomName)) { c.isObserver = true; seenRooms.add(c.roomName); }
  for (const c of clients) if (c.kind === 'match') c.isObserver = false;

  const t0 = Date.now();
  log(`[soak] ${OPT.clients} clients (${nFuzz} fuzz, ${nMatch} match) -> ${OPT.url} for ${OPT.duration}s seed=${OPT.seed}`);
  // stagger connects a little like real arrivals
  clients.forEach((c, i) => setTimeout(() => c.connect(), i * 40));

  const pump = setInterval(() => { const now = Date.now(); for (const c of clients) { try { c.step(now); } catch (e) { viol('harness_exception', e.stack?.split('\n').slice(0, 3).join(' | ')); } } }, 2);

  let killTimer = null, kills = 0;
  if (OPT.killUrl) {
    killTimer = setInterval(async () => { try { await fetch(OPT.killUrl); kills++; } catch { /* proxy gone */ } }, OPT.killEvery * 1000);
  }

  // Periodic progress so a long soak isn't silent.
  const progress = setInterval(() => {
    const secs = Math.round((Date.now() - t0) / 1000);
    const open = clients.filter((c) => c.open).length;
    const last = serverLog.stats.at(-1);
    log(`[soak] t=${secs}s open=${open}/${OPT.clients} ticks=${counters.ticksSeen} casts=${counters.casts} hits=${counters.hits} deaths=${counters.kills} viol=${[...violations.values()].reduce((a, v) => a + v.count, 0)}` +
      (last ? ` | server tick p95=${last.tickMs.p95}ms max=${last.tickMs.max}ms heap=${last.heapMB}MB rooms=${last.rooms}` : ''));
  }, 10000);

  await new Promise((r) => setTimeout(r, OPT.duration * 1000));

  clearInterval(pump); clearInterval(progress); if (killTimer) clearInterval(killTimer);
  for (const c of clients) c.stop();

  // Post-run: with --spawn, wait for the server to notice every socket is gone and verify cleanup.
  let cleanup = null;
  if (OPT.spawn) {
    // Give the server time to notice every close (a freeze on a busy dev box can delay that by
    // seconds), then take the first stats window that was recorded after the sockets were gone;
    // keep waiting up to 30s if that window still shows registered players.
    await new Promise((r) => setTimeout(r, OPT.idleWait * 1000));
    const settleFrom = serverLog.stats.length;
    for (let waited = 0; waited < 30000; waited += 1000) {
      await new Promise((r) => setTimeout(r, 1000));
      const w = serverLog.stats.length > settleFrom ? serverLog.stats.at(-1) : null;
      if (w && w.players === 0 && w.bots === 0 && waited >= 5000) break;
    }
    const last = serverLog.stats.at(-1);
    if (last) {
      cleanup = { rooms: last.rooms, players: last.players, bots: last.bots, projectiles: last.projectiles, effects: last.effects, domains: last.domains, barriers: last.barriers, snapshots: last.snapshots, pendingRespawns: last.pendingRespawns, votes: last.votes };
      // Only the 'lobby' (and any named public arena) may remain; match-/experiment- rooms and all bots must be gone.
      const maxRooms = OPT.rooms; // lobby + arenas the run created
      if (last.bots > 0) viol('leak_bots_after_idle', `${last.bots} bots still registered after all clients left`);
      if (last.players > 0) viol('leak_players_after_idle', `${last.players} players still registered`);
      if (last.rooms > maxRooms) viol('leak_rooms_after_idle', `${last.rooms} rooms remain (expected <= ${maxRooms})`);
    }
  }

  if (serverProc) {
    // Wait for the exit so the next run can bind the same port.
    serverProc.stoppedByHarness = true;
    const exited = new Promise((r) => serverProc.once('exit', r));
    try { serverProc.kill(); } catch { /* */ }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 4000))]);
  }

  // ── report ────────────────────────────────────────────────────────────────
  const st = serverLog.stats.filter((s) => s.players > 0 || s.bots > 0);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const heapSeries = st.map((s) => s.heapMB);
  const slope = (() => { // MB per minute via least squares over the 2nd half of the run (skips warmup)
    const pts = st.slice(Math.floor(st.length / 3)).map((s) => [s.t, s.heapMB]);
    if (pts.length < 4) return null;
    const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
    let num2 = 0, den = 0; for (const [x, y] of pts) { num2 += (x - mx) * (y - my); den += (x - mx) ** 2; }
    return den ? +(num2 / den * 60).toFixed(2) : null;
  })();
  const report = {
    options: OPT,
    counters,
    clientObserved: {
      serverTickSpacingMs: { n: serverSpacing.length, p50: pctOf(serverSpacing, 0.5), p95: pctOf(serverSpacing, 0.95), p99: pctOf(serverSpacing, 0.99), max: maxOf(serverSpacing) },
      recvGapMs: { n: recvGaps.length, p50: pctOf(recvGaps, 0.5), p95: pctOf(recvGaps, 0.95), p99: pctOf(recvGaps, 0.99), max: maxOf(recvGaps) },
      avgTickKB: tickBytes.length ? +(tickBytes.reduce((a, b) => a + b, 0) / tickBytes.length / 1024).toFixed(1) : 0,
      peakCollections: peak,
    },
    server: OPT.spawn ? {
      windows: st.length,
      stalls: st.reduce((a, s) => a + s.stalls, 0),
      rawMax: { tickMs: Math.max(0, ...st.map((s) => s.rawMaxTickMs)), spacingMs: Math.max(0, ...st.map((s) => s.rawMaxSpacingMs)) },
      series: serverLog.stats.map((w) => ({ t: w.t, rooms: w.rooms, players: w.players, bots: w.bots, tickP50: w.tickMs.p50, tickP95: w.tickMs.p95, tickMax: w.tickMs.max, spacingMax: w.spacingMs.max, lagMax: w.loopLagMs.max, cpuPct: w.cpuPct, heapMB: w.heapMB })),
      tickMs: { p50: +med(st.map((s) => s.tickMs.p50)).toFixed(3), p95: +Math.max(0, ...st.map((s) => s.tickMs.p95)).toFixed(3), max: +Math.max(0, ...st.map((s) => s.tickMs.max)).toFixed(3) },
      spacingMs: { p50: +med(st.map((s) => s.spacingMs.p50)).toFixed(3), p95: +Math.max(0, ...st.map((s) => s.spacingMs.p95)).toFixed(3), max: +Math.max(0, ...st.map((s) => s.spacingMs.max)).toFixed(3) },
      loopLagMs: { p95: +Math.max(0, ...st.map((s) => s.loopLagMs.p95)).toFixed(3), max: +Math.max(0, ...st.map((s) => s.loopLagMs.max)).toFixed(3) },
      heapMB: { first: heapSeries[0] ?? null, last: heapSeries.at(-1) ?? null, max: Math.max(0, ...heapSeries), slopeMBperMin: slope },
      rssMB: { max: Math.max(0, ...st.map((s) => s.rssMB)) },
      spinPct: { median: +med(st.map((s) => s.spinPct ?? 0)).toFixed(1), max: Math.max(0, ...st.map((s) => s.spinPct ?? 0)) },
      cpuPct: { median: +med(st.map((s) => s.cpuPct)).toFixed(1), max: Math.max(0, ...st.map((s) => s.cpuPct)) },
      peakRooms: Math.max(0, ...st.map((s) => s.rooms)),
      peakBots: Math.max(0, ...st.map((s) => s.bots)),
      peakServerCollections: {
        projectiles: Math.max(0, ...st.map((s) => s.projectiles)), effects: Math.max(0, ...st.map((s) => s.effects)),
        snapshots: Math.max(0, ...st.map((s) => s.snapshots)),
      },
      cleanupAfterIdle: cleanup,
      log: { tickError: serverLog.tickError, badMessage: serverLog.badMessage, uncaught: serverLog.uncaught, wsError: serverLog.wsError, exited: serverLog.exited, other: serverLog.other },
    } : null,
    violations: Object.fromEntries([...violations].map(([k, v]) => [k, v])),
  };

  console.log('\n==== soak report ====');
  console.log(`clients=${OPT.clients} fuzz=${nFuzz} match=${nMatch} rooms=${OPT.rooms} duration=${OPT.duration}s seed=${OPT.seed}`);
  console.log(`traffic: ${counters.ticksSeen} ticks seen (${counters.ticksParsed} validated), ${counters.msgsOut} msgs out (${counters.hostileSent} hostile)${counters.reorderedTicks ? `, ${counters.reorderedTicks} ticks reordered by the transport` : ''}, ${(counters.bytesIn / 1048576).toFixed(1)} MB in`);
  console.log(`gameplay: casts=${counters.casts} denied=${counters.castDenied} hits=${counters.hits} deaths=${counters.kills} respawns=${counters.respawns} matches ${counters.matchesStarted} started / ${counters.matchesEnded} ended, reconnects=${counters.reconnects}${OPT.killUrl ? ` (proxy kills=${kills})` : ''}`);
  const co = report.clientObserved;
  console.log(`server tick spacing (from tick timestamps): p50=${co.serverTickSpacingMs.p50} p95=${co.serverTickSpacingMs.p95} p99=${co.serverTickSpacingMs.p99} max=${co.serverTickSpacingMs.max} ms (target 15.625)`);
  console.log(`client receive gap: p50=${co.recvGapMs.p50} p95=${co.recvGapMs.p95} p99=${co.recvGapMs.p99} max=${co.recvGapMs.max} ms; avg tick ${co.avgTickKB} KB`);
  if (report.server) {
    const s = report.server;
    console.log(`SERVER tick duration: p50=${s.tickMs.p50}ms p95=${s.tickMs.p95}ms max=${s.tickMs.max}ms | spacing p50=${s.spacingMs.p50} p95=${s.spacingMs.p95} max=${s.spacingMs.max} | loop lag p95=${s.loopLagMs.p95} max=${s.loopLagMs.max}  (samples >250ms are counted as stalls, not percentiled: ${s.stalls} stalled, raw max tick ${s.rawMax.tickMs}ms / spacing ${s.rawMax.spacingMs}ms)`);
    console.log(`SERVER heap: first=${s.heapMB.first}MB last=${s.heapMB.last}MB max=${s.heapMB.max}MB slope=${s.heapMB.slopeMBperMin}MB/min rss max=${s.rssMB.max}MB; server CPU median=${s.cpuPct.median}% max=${s.cpuPct.max}% (Windows accounting is coarse; trust spin%) , tick-loop busy-wait=${s.spinPct.median}% of a core (max ${s.spinPct.max}%); peak rooms=${s.peakRooms} bots=${s.peakBots}`);
    console.log(`SERVER log: tickError=${s.log.tickError} badMessage=${s.log.badMessage} uncaught=${s.log.uncaught} wsError=${s.log.wsError} exited=${JSON.stringify(s.log.exited)}`);
    if (s.log.other.length) console.log('  other lines:\n   ' + s.log.other.join('\n   '));
    if (s.cleanupAfterIdle) console.log(`SERVER after idle: ${JSON.stringify(s.cleanupAfterIdle)}`);
  }
  if (violations.size === 0 && (!report.server || (report.server.log.tickError === 0 && report.server.log.uncaught === 0 && !report.server.log.exited))) {
    console.log('INVARIANTS: all held');
  } else {
    console.log('INVARIANT VIOLATIONS:');
    for (const [k, v] of violations) console.log(`  ${k}: ${v.count}\n     e.g. ${v.samples.join('\n          ')}`);
  }
  if (OPT.json) writeFileSync(OPT.json, JSON.stringify(report, null, 2));

  const bad = violations.size > 0 || (report.server && (report.server.log.tickError > 0 || report.server.log.uncaught > 0 || report.server.log.exited));
  process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error(e); try { serverProc?.kill(); } catch { /* */ } process.exit(2); });
