import { v4 as uuid } from 'uuid';
import { GameLoop } from './GameLoop.js';
import { SpellSystem } from './systems/SpellSystem.js';
import { LagCompensation } from './systems/LagCompensation.js';
import { S2C } from 'shared/events';
import {
  TICK_RATE, TICK_INTERVAL, GRAVITY, BASE_MOVE_SPEED, PLAYER_HEIGHT,
  ARENA_RADIUS, JUMP_FORCE, PLAYER_MAX_HEALTH, RESPAWN_DELAY,
  STARTING_SKILL_POINTS, POINTS_PER_KILL, POINTS_PER_ASSIST,
  STATE_HISTORY_TICKS, MAX_CONCURRENT_DOMAINS,
} from 'shared/constants';
import { getSpell } from 'shared/spells';

const SPAWN_POSITIONS = [
  { x: 0, y: PLAYER_HEIGHT, z: -20 },
  { x: 20, y: PLAYER_HEIGHT, z: 0 },
  { x: 0, y: PLAYER_HEIGHT, z: 20 },
  { x: -20, y: PLAYER_HEIGHT, z: 0 },
  { x: 14, y: PLAYER_HEIGHT, z: -14 },
  { x: 14, y: PLAYER_HEIGHT, z: 14 },
  { x: -14, y: PLAYER_HEIGHT, z: 14 },
  { x: -14, y: PLAYER_HEIGHT, z: -14 },
];

export class Room {
  constructor({ id, server }) {
    this.id = id;
    this.server = server;
    this.playerIds = new Set();
    this.projectiles = new Map();  // projectileId → projectile state
    this.barriers = new Map();     // barrierId → barrier state
    this.effects = new Map();      // effectId → aoe effect state
    this.domains = new Map();      // domainId → domain state
    this.tick = 0;
    this.spawnIndex = 0;
    this.spellSystem = new SpellSystem(this);
    this.lagCompensation = new LagCompensation(STATE_HISTORY_TICKS);
    this.loop = new GameLoop(TICK_RATE, () => this.update());
    this._pendingRespawns = []; // { playerId, at }
  }

  start() {
    this.loop.start();
  }

  stop() {
    this.loop.stop();
  }

  addPlayer(player) {
    this.playerIds.add(player.id);
    player.roomId = this.id;
    player.skillPoints = STARTING_SKILL_POINTS;

    // Send full current state to the joining player
    this.server.send(player, {
      type: S2C.ROOM_STATE,
      roomId: this.id,
      tick: this.tick,
      timestamp: Date.now(),
      players: this._serializePlayers(),
      projectiles: this._serializeProjectiles(),
      effects: this._serializeEffects(),
      domains: this._serializeDomains(),
    });

    // Notify other players
    this.server.broadcast(this.id, {
      type: S2C.PLAYER_JOINED,
      player: player.serialize(),
    }, player.id);
  }

  removePlayer(playerId) {
    this.playerIds.delete(playerId);
    this.server.broadcast(this.id, { type: S2C.PLAYER_LEFT, playerId });
  }

  spawnPlayer(player) {
    const pos = SPAWN_POSITIONS[this.spawnIndex % SPAWN_POSITIONS.length];
    this.spawnIndex++;
    player.spawn({ ...pos });
    this.server.broadcast(this.id, {
      type: S2C.PLAYER_RESPAWNED,
      playerId: player.id,
      position: player.position,
    });
  }

  scheduleRespawn(playerId) {
    this._pendingRespawns.push({ playerId, at: Date.now() + RESPAWN_DELAY });
  }

  // ── Main game loop ──────────────────────────────────────────────────────

  update() {
    const now = Date.now();
    const dt = TICK_INTERVAL / 1000; // seconds

    // Process pending respawns
    const remaining = [];
    for (const r of this._pendingRespawns) {
      if (now >= r.at) {
        const p = this.server.players.get(r.playerId);
        if (p) this.spawnPlayer(p);
      } else {
        remaining.push(r);
      }
    }
    this._pendingRespawns = remaining;

    // Process each player's movement
    for (const pid of this.playerIds) {
      const player = this.server.players.get(pid);
      if (!player || !player.isAlive) continue;
      this._simulatePlayer(player, dt, now);
    }

    // Simulate projectiles
    this.spellSystem.tickProjectiles(dt, now);

    // Simulate effects / DoTs
    this.spellSystem.tickEffects(dt, now);

    // Tick player status effects
    for (const pid of this.playerIds) {
      const player = this.server.players.get(pid);
      if (player) player.tickEffects(now);
    }

    // Save snapshot for lag compensation
    this.lagCompensation.save(this.tick, now, this._snapshotState());

    // Broadcast authoritative state
    this.tick++;
    if (this.tick % 1 === 0) { // every tick for now (can skip for bandwidth)
      this._broadcastTick(now);
    }
  }

  _simulatePlayer(player, dt, now) {
    if (!player.pendingInput) return;
    const input = player.pendingInput;
    player.pendingInput = null;

    const speedMult = player.getSpeedMultiplier();
    const speed = BASE_MOVE_SPEED * speedMult;

    // Horizontal movement
    const yaw = player.yaw;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    let vx = 0, vz = 0;

    if (input.flags & 1)  { vz -= cos; vx -= sin; } // forward
    if (input.flags & 2)  { vz += cos; vx += sin; } // backward
    if (input.flags & 4)  { vz += sin; vx -= cos; } // left
    if (input.flags & 8)  { vz -= sin; vx += cos; } // right

    const len = Math.sqrt(vx * vx + vz * vz);
    if (len > 0) { vx = (vx / len) * speed; vz = (vz / len) * speed; }

    player.velocity.x = vx;
    player.velocity.z = vz;

    // Vertical (gravity + jump)
    if (!player.isGrounded) {
      player.velocity.y += GRAVITY * dt;
    }

    // Jump
    if ((input.flags & 16) && player.isGrounded) {
      player.velocity.y = JUMP_FORCE;
      player.isGrounded = false;
    }

    // Integrate position
    player.position.x += player.velocity.x * dt;
    player.position.y += player.velocity.y * dt;
    player.position.z += player.velocity.z * dt;

    // Floor collision (simple)
    if (player.position.y <= PLAYER_HEIGHT) {
      player.position.y = PLAYER_HEIGHT;
      player.velocity.y = 0;
      player.isGrounded = true;
    }

    // Arena boundary (cylinder)
    const dx = player.position.x, dz = player.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > ARENA_RADIUS - 1) {
      const scale = (ARENA_RADIUS - 1) / dist;
      player.position.x *= scale;
      player.position.z *= scale;
    }

    // Update rotation from input
    player.yaw = input.yaw;
    player.pitch = input.pitch;
  }

  processInput(player, input) {
    // Store latest input for next tick
    player.pendingInput = input;
    player.lastInputSeq = input.seq;

    // Handle spell cast in input
    if (input.cast) {
      this.spellSystem.handleCastRequest(player, input.cast, input.clientTimestamp);
    }

    // Handle mobility
    if (input.mobility) {
      this.spellSystem.handleMobility(player, input);
    }
  }

  applyDamage(targetId, damage, sourceId, spellId) {
    const target = this.server.players.get(targetId);
    if (!target || !target.isAlive) return 0;
    if (target.hasEffect('phase')) return 0;

    // Apply passive defense modifiers
    let finalDamage = damage;

    // Earth: Earthen Skin passive
    if (target.class === 'earth' && target.unlockedNodes.has('earthen_skin')) {
      const defReduction = target.health / target.maxHealth < 0.5 ? 0.10 : 0.05;
      finalDamage *= (1 - defReduction);
    }

    // Ice Brittle: slowed targets take +15%
    if (target.hasEffect('slow') && this._sourceHasPassive(sourceId, 'brittle')) {
      finalDamage *= 1.15;
    }

    // Dark Hollow: <30% HP takes +20%
    if (target.health / target.maxHealth < 0.3 && this._sourceHasPassive(sourceId, 'hollow')) {
      finalDamage *= 1.2;
    }

    target.health = Math.max(0, target.health - Math.round(finalDamage));
    target.damageTaken += Math.round(finalDamage);

    // Track attacker's damage for Death Note / assists
    const attacker = this.server.players.get(sourceId);
    if (attacker) {
      attacker.damageDealt += Math.round(finalDamage);
      attacker.recordDamageTo(targetId);
    }

    if (target.health <= 0) {
      this._handleDeath(target, sourceId);
    }

    return Math.round(finalDamage);
  }

  _handleDeath(player, killerId) {
    // Check phoenix passive (fire)
    if (player.class === 'fire' && player.unlockedNodes.has('phoenix') && !player.oncePerLifeUsed.has('phoenix')) {
      player.health = Math.round(player.maxHealth * 0.2);
      player.oncePerLifeUsed.add('phoenix');
      this.spellSystem.triggerEffect('phoenix_burst', player.position, player.id);
      return;
    }

    // Check dark Undying passive
    if (player.class === 'dark' && player.unlockedNodes.has('undying') && !player.oncePerLifeUsed.has('undying')) {
      player.health = 1;
      player.oncePerLifeUsed.add('undying');
      this.spellSystem.handleMobility(player, { mobilityForced: true });
      return;
    }

    player.isAlive = false;
    player.health = 0;

    const killer = this.server.players.get(killerId);
    if (killer) {
      killer.kills++;
      killer.skillPoints += POINTS_PER_KILL;
      // Vampiric: Crimson Hunger — burst heal on kill
      if (killer.class === 'dark' && killer.unlockedNodes.has('crimson_hunger')) {
        killer.health = Math.min(killer.maxHealth, killer.health + 40);
      }
    }

    this.server.broadcast(this.id, {
      type: S2C.PLAYER_DIED,
      playerId: player.id,
      killerId: killerId ?? null,
      killerName: killer?.username ?? null,
      victimName: player.username,
    });

    this.server.broadcast(this.id, {
      type: S2C.KILL_FEED,
      killer: killer?.username ?? 'Arena',
      victim: player.username,
      spellId: null,
    });

    this.scheduleRespawn(player.id);
  }

  _sourceHasPassive(sourceId, passiveId) {
    const p = this.server.players.get(sourceId);
    return p?.unlockedNodes.has(passiveId) ?? false;
  }

  getActiveDomain() {
    for (const [, d] of this.domains) {
      if (d.active) return d;
    }
    return null;
  }

  _snapshotState() {
    const players = {};
    for (const pid of this.playerIds) {
      const p = this.server.players.get(pid);
      if (p) players[pid] = {
        position: { ...p.position },
        velocity: { ...p.velocity },
        health: p.health,
        isAlive: p.isAlive,
        activeEffects: new Map(p.activeEffects),
      };
    }
    const projectiles = {};
    for (const [id, proj] of this.projectiles) {
      projectiles[id] = { ...proj, position: { ...proj.position }, velocity: { ...proj.velocity } };
    }
    return { players, projectiles };
  }

  _serializePlayers() {
    const out = {};
    for (const pid of this.playerIds) {
      const p = this.server.players.get(pid);
      if (p) out[pid] = p.serialize();
    }
    return out;
  }

  _serializeProjectiles() {
    const out = {};
    for (const [id, p] of this.projectiles) out[id] = p;
    return out;
  }

  _serializeEffects() {
    const out = {};
    for (const [id, e] of this.effects) out[id] = e;
    return out;
  }

  _serializeDomains() {
    const out = {};
    for (const [id, d] of this.domains) out[id] = d;
    return out;
  }

  _broadcastTick(now) {
    const msg = JSON.stringify({
      type: S2C.GAME_TICK,
      tick: this.tick,
      timestamp: now,
      players: this._serializePlayers(),
      projectiles: this._serializeProjectiles(),
      effects: this._serializeEffects(),
      domains: this._serializeDomains(),
    });

    for (const pid of this.playerIds) {
      const p = this.server.players.get(pid);
      if (p && p.ws.readyState === 1) {
        // Include ack of last received input sequence
        const tickMsg = JSON.parse(msg);
        tickMsg.ackSeq = p.lastInputSeq;
        p.ws.send(JSON.stringify(tickMsg));
      }
    }
  }
}
