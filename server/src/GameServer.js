import { WebSocketServer } from 'ws';
import { v4 as uuid } from 'uuid';
import { RedisClient } from './redis/RedisClient.js';
import { Room } from './Room.js';
import { Player } from './Player.js';
import { WebSocketHandler } from './networking/WebSocketHandler.js';
import { S2C } from 'shared/events';

export class GameServer {
  constructor({ port, redisUrl }) {
    this.port = port;
    this.redisUrl = redisUrl;
    this.wss = null;
    this.redis = null;
    this.rooms = new Map(); // roomId → Room
    this.players = new Map(); // playerId → Player
    this.wsHandler = new WebSocketHandler(this);
  }

  async start() {
    this.redis = new RedisClient(this.redisUrl);
    await this.redis.connect();

    this.wss = new WebSocketServer({ port: this.port });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));

    // Create a default lobby room
    this.getOrCreateRoom('lobby');

    console.log(`[GameServer] Running on ws://0.0.0.0:${this.port}`);
  }

  async stop() {
    console.log('[GameServer] Shutting down...');
    for (const room of this.rooms.values()) room.stop();
    this.wss?.close();
    await this.redis?.disconnect();
    process.exit(0);
  }

  onConnection(ws, req) {
    const playerId = uuid();
    const player = new Player({ id: playerId, ws, username: null });
    this.players.set(playerId, player);

    console.log(`[GameServer] Player connected: ${playerId} (${this.players.size} total)`);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.wsHandler.handle(player, msg);
      } catch (e) {
        console.error('[GameServer] Bad message from', playerId, e.message);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[GameServer] Player disconnected: ${playerId} (code=${code}, reason=${reason})`);
      this.onDisconnect(player);
    });
    ws.on('error', (err) => console.error('[GameServer] WS error:', playerId, err.message));

    // Greet with the player's own ID
    console.log(`[GameServer] Sending ROOM_JOINED to ${playerId}, ws.readyState=${ws.readyState}`);
    this.send(player, { type: S2C.ROOM_JOINED, playerId });
    console.log(`[GameServer] ROOM_JOINED sent to ${playerId}`);
  }

  onDisconnect(player) {
    if (player.roomId) {
      const room = this.rooms.get(player.roomId);
      room?.removePlayer(player.id);
    }
    this.players.delete(player.id);
  }

  getOrCreateRoom(roomId = uuid()) {
    if (!this.rooms.has(roomId)) {
      const room = new Room({ id: roomId, server: this });
      this.rooms.set(roomId, room);
      room.start();
    }
    return this.rooms.get(roomId);
  }

  send(player, msg) {
    if (player.ws.readyState === 1 /* OPEN */) {
      player.ws.send(JSON.stringify(msg));
    }
  }

  broadcast(roomId, msg, excludeId = null) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const json = JSON.stringify(msg);
    for (const pid of room.playerIds) {
      const p = this.players.get(pid);
      if (p && pid !== excludeId && p.ws.readyState === 1) {
        p.ws.send(json);
      }
    }
  }
}
