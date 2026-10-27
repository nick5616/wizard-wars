import { WebSocketServer } from 'ws';
import { v4 as uuid } from 'uuid';
import { RedisClient } from './redis/RedisClient.js';
import { Room } from './Room.js';
import { Player } from './Player.js';
import { WebSocketHandler } from './networking/WebSocketHandler.js';
import { SimulationRunner } from './sim/SimulationRunner.js';
import { S2C } from 'shared/events';
import { startStats } from './stats.js';

/**
 * Authoritative "is this a trusted local dev connection" check, used to gate
 * Experiment Lab features (god-mode, bot/sim controls). A real deployed
 * server (Cloud Run, behind any proxy/load balancer) never sees a loopback
 * remoteAddress from an external client, so this is a genuine security
 * boundary, not just client-side UI hiding.
 */
function isLoopbackAddress(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERSIST_TTL_SECONDS = 7 * 24 * 3600; // saved profiles expire after a week of inactivity
// Inbound hardening. A real client sends ~64 PLAYER_INPUT/s plus the odd
// clock-sync / action, in messages well under 1KB; a TCP stall delivers a few
// seconds' backlog at once. The bucket is sized for that and nothing more.
const MSG_BUCKET_CAPACITY = 400; // burst allowance (messages)
const MSG_REFILL_PER_SEC = 200; // sustained messages/second
const MAX_MESSAGE_BYTES = 16 * 1024; // remote clients; localhost (lab / design tools) gets MAX_LOCAL_MESSAGE_BYTES
const MAX_LOCAL_MESSAGE_BYTES = 1024 * 1024; // Design Lab "Save to repo" ships the whole card bank in one frame
const MAX_SOCKET_BUFFER_BYTES = 8 * 1024 * 1024; // a client this far behind on reads is dead weight: queueing 64 ticks/s for it only grows the heap
const ABUSE_DROP_LIMIT = 4000; // dropped messages (rate/size) before the socket is cut
const BAD_MESSAGE_LOG_LIMIT = 5; // per connection, so a fuzzer can't turn stderr into the bottleneck
export const MAX_ROOMS = 64;
const HEARTBEAT_INTERVAL_MS = 20000; // catches connections an intermediary silently dropped without a close frame

export class GameServer {
  constructor({ port, redisUrl }) {
    this.port = port;
    this.redisUrl = redisUrl;
    this.wss = null;
    this.redis = null;
    this.rooms = new Map(); // roomId → Room
    this.players = new Map(); // playerId → Player
    this.wsHandler = new WebSocketHandler(this);
    this.simulationRunner = new SimulationRunner();
  }

  async start() {
    this.redis = new RedisClient(this.redisUrl);
    await this.redis.connect();

    // `ws` defaults maxPayload to 100MiB: one frame could be buffered whole before we ever look at it.
    // One stray throw from an async handler must not take every room down with it.
    process.on('unhandledRejection', (err) => console.error('[GameServer] Unhandled rejection:', err));
    process.on('uncaughtException', (err) => console.error('[GameServer] Uncaught exception (continuing):', err));

    this.wss = new WebSocketServer({ port: this.port, maxPayload: MAX_LOCAL_MESSAGE_BYTES, perMessageDeflate: false });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));

    // Create a default lobby room
    this.getOrCreateRoom('lobby');

    this._heartbeatInterval = setInterval(() => this._heartbeatTick(), HEARTBEAT_INTERVAL_MS);

    this._stopStats = startStats(this);

    console.log(`[GameServer] Running on ws://0.0.0.0:${this.port}`);
  }

  async stop() {
    console.log('[GameServer] Shutting down...');
    if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);
    this._stopStats?.();
    for (const room of this.rooms.values()) room.destroy();
    this.wss?.close();
    await this.redis?.disconnect();
    process.exit(0);
  }

  /**
   * Pings every connected (non-bot) socket; terminates any that didn't pong
   * back since the last cycle. Idle WebSocket connections can otherwise be
   * silently killed by an intermediary proxy/NAT with no close frame at
   * all, which is one source of the "random disconnect" symptom -- this
   * catches it and lets the normal close/reconnect-with-persistence path
   * take over instead of leaving a half-dead socket registered.
   */
  _heartbeatTick() {
    for (const player of this.players.values()) {
      if (player.isBot || !player.ws) continue;
      if (player.isAliveForHeartbeat === false) {
        try { player.ws.terminate(); } catch { /* already gone */ }
        continue;
      }
      player.isAliveForHeartbeat = false;
      try { player.ws.ping(); } catch { /* socket already closing */ }
    }
  }

  /** Parses `?clientId=...` off the upgrade request URL; only a syntactically valid UUID is trusted. */
  _parseClientId(req) {
    try {
      const url = new URL(req?.url ?? '', 'http://placeholder');
      const id = url.searchParams.get('clientId');
      return id && UUID_RE.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  onConnection(ws, req) {
    const requestedId = this._parseClientId(req);
    const playerId = requestedId ?? uuid();

    // Same persistent identity reconnecting while an old session is still
    // registered (duplicate tab, or a fast client auto-reconnect racing the
    // old socket's close event): tear the stale one down ourselves first --
    // strip its listeners before closing so its own 'close' handler can't
    // also fire and delete the *new* Player we're about to register under
    // the same map key.
    const stale = this.players.get(playerId);
    if (stale) {
      stale.ws?.removeAllListeners();
      // removeAllListeners also drops the 'error' handler; terminate() can still emit one, which with no listener would crash the process.
      stale.ws?.on('error', () => {});
      // 4001 = "replaced by a newer session": lets the old tab know NOT to auto-reconnect
      // (it would kick the new tab, which would reconnect and kick it back, forever).
      // terminate() as a fallback so a client that never answers the close can't linger.
      try { stale.ws?.close(4001, 'replaced by a newer session'); } catch { /* already gone */ }
      const staleWs = stale.ws;
      setTimeout(() => { try { staleWs?.terminate(); } catch { /* already gone */ } }, 1000).unref?.();
      this.onDisconnect(stale);
    }

    const player = new Player({ id: playerId, ws, username: null });
    player.isLocalConnection = isLoopbackAddress(req?.socket?.remoteAddress);
    player.isAliveForHeartbeat = true;
    this.players.set(playerId, player);

    console.log(`[GameServer] Player connected: ${playerId} (${this.players.size} total)${player.isLocalConnection ? ' [local]' : ''}`);

    player.msgTokens = MSG_BUCKET_CAPACITY;
    player.msgTokensAt = Date.now();
    player.msgDropped = 0;
    player.badMessages = 0;

    ws.on('message', (data, isBinary) => {
      if (isBinary) return; // the protocol is JSON text only
      const nowMs = Date.now();
      player.msgTokens = Math.min(MSG_BUCKET_CAPACITY, player.msgTokens + (nowMs - player.msgTokensAt) * (MSG_REFILL_PER_SEC / 1000));
      player.msgTokensAt = nowMs;
      const tooBig = data.length > (player.isLocalConnection ? MAX_LOCAL_MESSAGE_BYTES : MAX_MESSAGE_BYTES);
      if (tooBig || player.msgTokens < 1) {
        if (++player.msgDropped > ABUSE_DROP_LIMIT) { try { ws.terminate(); } catch { /* gone */ } }
        return;
      }
      player.msgTokens -= 1;
      try {
        const msg = JSON.parse(data.toString());
        if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
        this.wsHandler.handle(player, msg);
      } catch (e) {
        if (++player.badMessages <= BAD_MESSAGE_LOG_LIMIT) console.error('[GameServer] Bad message from', playerId, e.message);
      }
    });

    ws.on('pong', () => { player.isAliveForHeartbeat = true; });

    ws.on('close', (code, reason) => {
      console.log(`[GameServer] Player disconnected: ${playerId} (code=${code}, reason=${reason})`);
      try {
        this.onDisconnect(player);
      } catch (e) {
        console.error('[GameServer] onDisconnect failed for', playerId, e);
      }
    });
    ws.on('error', (err) => console.error('[GameServer] WS error:', playerId, err.message));

    this._restoreAndGreet(player);
  }

  /** Best-effort restore from Redis (no-ops cleanly if unavailable) before sending ROOM_JOINED. */
  async _restoreAndGreet(player) {
    if (this.redis) {
      const persisted = await this.redis.get(`player:${player.id}`);
      if (persisted) player.restoreFrom(persisted);
    }
    console.log(`[GameServer] Sending ROOM_JOINED to ${player.id}${player.class ? ` (resumed as ${player.username}, class=${player.class}, level=${player.level})` : ''}`);
    this.send(player, {
      type: S2C.ROOM_JOINED,
      playerId: player.id,
      username: player.username,
      class: player.class,
      level: player.level,
      elo: player.elo,
    });
  }

  /** Best-effort snapshot of a real player's progress to Redis; safe no-op for bots or if Redis is down. */
  async persistPlayer(player) {
    if (!this.redis || player.isBot) return;
    await this.redis.set(`player:${player.id}`, player.toPersisted(), PERSIST_TTL_SECONDS);
  }

  onDisconnect(player) {
    this.persistPlayer(player);
    if (player.roomId) {
      this.rooms.get(player.roomId)?.removePlayer(player.id);
      this.cleanupEmptyPrivateRoom(player.roomId);
    }
    // Only unregister OUR entry: if a reconnect with the same clientId already
    // replaced this Player in the map, deleting by id would evict the new one.
    if (this.players.get(player.id) === player) this.players.delete(player.id);
  }

  /**
   * Once nobody real is left in a room, free what the room owns. Private rooms
   * (Experiment Lab sandboxes, single-player matches) and any ad-hoc named
   * room are torn down entirely -- loop stopped, bots unregistered; before,
   * only experiment-/match- rooms were ever deleted and even those left their
   * bots in server.players forever, while every other roomId a client typed in
   * lived (and ticked) for the life of the process. The shared 'lobby' stays,
   * but its bots go: they would otherwise fight each other indefinitely in an
   * empty room. Safe to call for any roomId.
   */
  cleanupEmptyPrivateRoom(roomId) {
    const room = roomId && this.rooms.get(roomId);
    if (!room || room.humanCount() > 0) return;
    if (roomId === 'lobby') {
      for (const botId of [...room.botControllers.keys()]) room.despawnBot(botId);
      return;
    }
    room.destroy();
    this.rooms.delete(roomId);
  }

  /** Returns the room, creating it if needed; null when a NEW room would exceed MAX_ROOMS. */
  getOrCreateRoom(roomId = uuid(), options = {}) {
    if (!this.rooms.has(roomId)) {
      if (this.rooms.size >= MAX_ROOMS) return null;
      const room = new Room({ id: roomId, server: this, ...options });
      this.rooms.set(roomId, room);
      room.start();
    }
    return this.rooms.get(roomId);
  }

  send(player, msg) {
    // `player` can legitimately be undefined: projectile / effect owners are
    // looked up by id and may have disconnected since the cast. That used to
    // throw out of tickProjectiles mid-loop, skipping every later projectile
    // and the removal pass, and re-throwing on every tick until the stranded
    // projectile expired.
    if (player?.isConnected()) {
      if (player.ws.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) { player.ws.terminate(); return; }
      player.ws.send(JSON.stringify(msg));
    }
  }

  broadcast(roomId, msg, excludeId = null) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const json = JSON.stringify(msg);
    for (const pid of room.playerIds) {
      const p = this.players.get(pid);
      if (p && pid !== excludeId && p.isConnected()) {
        if (p.ws.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) { p.ws.terminate(); continue; }
        p.ws.send(json);
      }
    }
  }
}
