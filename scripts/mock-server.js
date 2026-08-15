#!/usr/bin/env node
/**
 * Lightweight mock WebSocket server for frontend-only development.
 * Simulates just enough server behavior to get the game rendering:
 *   - clock sync, room join, class select, game ticks, respawn
 * No Redis, no game logic, no Docker required.
 *
 * Usage: node scripts/mock-server.js
 *        npm run dev:mock  (runs this + Vite concurrently)
 */

const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT ?? '8080', 10);
const TICK_HZ = 20;

const wss = new WebSocketServer({ port: PORT });
let globalTick = 0;

function makePlayer(id, overrides = {}) {
  return {
    id,
    username: `Wizard_${id.slice(-4)}`,
    class: 'fire',
    isAlive: true,
    health: 200,
    maxHealth: 200,
    position: { x: 0, y: 1.8, z: 0 },
    yaw: 0,
    pitch: 0,
    equippedSpells: ['fireball', null, null, null],
    cooldowns: {},
    activeEffects: {},
    skillPoints: 3,
    unlockedNodes: [],
    kills: 0,
    ping: 5,
    ...overrides,
  };
}

wss.on('connection', (ws) => {
  const playerId = `mock-${Date.now().toString(36)}`;
  let player = makePlayer(playerId);
  let tickInterval = null;

  function send(msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function tick() {
    globalTick++;
    send({
      type: 's2c:game_tick',
      tick: globalTick,
      timestamp: Date.now(),
      ackSeq: 0,
      players: { [playerId]: player },
      projectiles: {},
      effects: {},
      domains: {},
      barriers: {},
    });
  }

  // Immediately tell the client it's connected
  send({ type: 's2c:room_joined', playerId });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {
      case 'c2s:clock_sync':
        send({ type: 's2c:clock_sync', t1: msg.t1, t2: Date.now(), t3: Date.now() });
        break;

      case 'c2s:join_room':
        send({
          type: 's2c:room_state',
          roomId: msg.roomId ?? 'lobby',
          tick: globalTick,
          timestamp: Date.now(),
          ackSeq: 0,
          players: { [playerId]: player },
          projectiles: {},
          effects: {},
          domains: {},
        });
        if (!tickInterval) {
          tickInterval = setInterval(tick, 1000 / TICK_HZ);
        }
        break;

      case 'c2s:select_class':
        player = { ...player, class: msg.class ?? player.class };
        break;

      case 'c2s:player_input':
        if (msg.yaw != null) player = { ...player, yaw: msg.yaw, pitch: msg.pitch ?? player.pitch };
        break;

      case 'c2s:equip_spell': {
        const spells = [...player.equippedSpells];
        spells[msg.slotIndex ?? 0] = msg.spellId ?? null;
        player = { ...player, equippedSpells: spells };
        break;
      }

      case 'c2s:respawn':
        player = { ...player, isAlive: true, health: player.maxHealth, position: { x: 0, y: 1.8, z: 0 } };
        send({ type: 's2c:player_respawned', playerId, position: player.position });
        break;

      case 'c2s:buy_skill_node':
        if (player.skillPoints > 0 && msg.nodeId) {
          player = {
            ...player,
            skillPoints: player.skillPoints - 1,
            unlockedNodes: [...player.unlockedNodes, msg.nodeId],
          };
          send({ type: 's2c:skill_bought', nodeId: msg.nodeId, skillPoints: player.skillPoints });
        }
        break;

      case 'c2s:debug_grant':
        player = { ...player, skillPoints: player.skillPoints + 5 };
        break;
    }
  });

  ws.on('close', () => {
    if (tickInterval) clearInterval(tickInterval);
  });

  console.log(`[mock] client connected → ${playerId}`);
});

wss.on('listening', () => {
  console.log(`[mock] WebSocket server on ws://localhost:${PORT}`);
  console.log('[mock] Frontend-only mode — no Redis, no game logic');
});
