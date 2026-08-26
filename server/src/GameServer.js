import { WebSocketServer } from 'ws';
import { v4 as uuid } from 'uuid';
import { RedisClient } from './redis/RedisClient.js';
import { Room } from './Room.js';
import { Player } from './Player.js';
import { WebSocketHandler } from './networking/WebSocketHandler.js';
import { SimulationRunner } from './sim/SimulationRunner.js';
import { S2C } from 'shared/events';

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

    this.wss = new WebSocketServer({ port: this.port });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));

    // Create a default lobby room
    this.getOrCreateRoom('lobby');

    this._heartbeatInterval = setInterval(() => this._heartbeatTick(), HEARTBEAT_INTERVAL_MS);

    console.log(`[GameServer] Running on ws://0.0.0.0:${this.port}`);
  }

  async stop() {
    console.log('[GameServer] Shutting down...');
    if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);
    for (const room of this.rooms.values()) room.stop();
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
      try { stale.ws?.terminate(); } catch { /* already gone */ }
      this.onDisconnect(stale);
    }

    const player = new Player({ id: playerId, ws, username: null });
    player.isLocalConnection = isLoopbackAddress(req?.socket?.remoteAddress);
    player.isAliveForHeartbeat = true;
    this.players.set(playerId, player);

    console.log(`[GameServer] Player connected: ${playerId} (${this.players.size} total)${player.isLocalConnection ? ' [local]' : ''}`);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.wsHandler.handle(player, msg);
      } catch (e) {
        console.error('[GameServer] Bad message from', playerId, e.message);
      }
    });

    ws.on('pong', () => { player.isAliveForHeartbeat = true; });

    ws.on('close', (code, reason) => {
      console.log(`[GameServer] Player disconnected: ${playerId} (code=${code}, reason=${reason})`);
      this.onDisconnect(player);
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
    this.players.delete(player.id);
  }

  /**
   * Experiment Lab sandboxes and single-player match rooms are both private
   * per-player rooms — tear them down (bots included) once nobody real is
   * left in them, rather than leaking a running GameLoop forever. Safe to
   * call for any roomId; no-ops otherwise (e.g. the shared 'lobby').
   */
  cleanupEmptyPrivateRoom(roomId) {
    if (!roomId || !(roomId.startsWith('experiment-') || roomId.startsWith('match-'))) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    const hasRealPlayer = [...room.playerIds].some((pid) => !this.players.get(pid)?.isBot);
    if (!hasRealPlayer) {
      room.stop();
      this.rooms.delete(roomId);
    }
  }

  getOrCreateRoom(roomId = uuid(), options = {}) {
    if (!this.rooms.has(roomId)) {
      const room = new Room({ id: roomId, server: this, ...options });
      this.rooms.set(roomId, room);
      room.start();
    }
    return this.rooms.get(roomId);
  }

  send(player, msg) {
    if (player.isConnected()) {
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
        p.ws.send(json);
      }
    }
  }
}
