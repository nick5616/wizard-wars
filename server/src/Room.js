import { v4 as uuid } from 'uuid';
import { GameLoop } from './GameLoop.js';
import { SpellSystem } from './systems/SpellSystem.js';
import { ProgressionSystem } from './systems/ProgressionSystem.js';
import { LagCompensation } from './systems/LagCompensation.js';
import { BotController } from './systems/BotAI.js';
import { Bot } from './Bot.js';
import { S2C, INPUT_FLAGS } from 'shared/events';
import {
  TICK_RATE, TICK_INTERVAL, GRAVITY, BASE_MOVE_SPEED, PLAYER_HEIGHT,
  ARENA_RADIUS, JUMP_FORCE, PLAYER_MAX_HEALTH, RESPAWN_DELAY,
  STARTING_SKILL_POINTS, POINTS_PER_LEVEL,
  STATE_HISTORY_TICKS, MAX_CONCURRENT_DOMAINS, PLAYER_CAPSULE_RADIUS,
  GROUND_ACCEL, AIR_ACCEL, GROUND_FRICTION, STOP_SPEED, AIR_CAP_SPEED, MAX_AIR_JUMPS,
} from 'shared/constants';
import { getSpell } from 'shared/spells';
import { XP_PER_KILL, levelFromXp, rankForLevel, hatBuffTierForLevel, HAT_BUFF_DAMAGE_MULT } from 'shared/leveling';
import { terrainHeightAt, resolveTerrainCollision, resolveCircleObstacles } from 'shared/mapLayout';
import { applyGroundFriction, applyGroundAccel, applyAirAccel, normalizeWishDir } from 'shared/movement';
import { STATUS_EFFECTS, DOMAIN_CONFIGS } from 'shared/gameConfig';
import { CLASS_LABEL, classSymbol } from 'shared/classFlavor';

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
  constructor({ id, server, respawnEnabled = true }) {
    this.id = id;
    this.server = server;
    this.respawnEnabled = respawnEnabled;
    this.playerIds = new Set();
    this.projectiles = new Map();  // projectileId → projectile state
    this.barriers = new Map();     // barrierId → barrier state
    this.effects = new Map();      // effectId → aoe effect state
    this.domains = new Map();      // domainId → domain state
    this.tick = 0;
    this.spawnIndex = 0;
    this.spellSystem = new SpellSystem(this);
    this.progressionSystem = new ProgressionSystem(this);
    this.lagCompensation = new LagCompensation(STATE_HISTORY_TICKS);
    this.loop = new GameLoop(TICK_RATE, () => this.update());
    this._pendingRespawns = []; // { playerId, at }
    this.botControllers = new Map(); // botId -> BotController
    this.damageLog = new Map(); // spellId -> { totalDamage, hits } — feeds the Experiment Lab's "how well do abilities perform" stats
    this.headToHead = new Map(); // "${winnerId}>${loserId}" -> kill count, feeds the Experiment Lab's live combat log
  }

  /** Kills `a` has scored on `b` so far this room. */
  _h2h(a, b) {
    return this.headToHead.get(`${a}>${b}`) ?? 0;
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
      barriers: this._serializeBarriers(),
    });

    // Notify other players
    this.server.broadcast(this.id, {
      type: S2C.PLAYER_JOINED,
      player: player.serialize(),
    }, player.id);
  }

  removePlayer(playerId) {
    this.playerIds.delete(playerId);
    // Non-blocking skill-point prompts never expire on their own (see
    // ProgressionSystem._openChoice) -- without this, a player who
    // disconnects mid-prompt would leave a stray entry behind forever.
    this.progressionSystem.pendingVotes.delete(playerId);
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

  /** Creates and spawns a bot into this room. Returns the Bot instance. */
  spawnBot({ class: wizardClass, behavior = 'aggressive', position = null, loadout = null, autoEquipOnLevel = true }) {
    const id = `bot-${uuid()}`;
    // "EarthBot_4324" -- names the class so a killfeed/scoreboard entry reads
    // as an actual opponent instead of an anonymous id fragment.
    const namePrefix = CLASS_LABEL[wizardClass] ?? 'Wizard';
    const username = `${namePrefix}Bot_${1000 + Math.floor(Math.random() * 9000)}`;
    const bot = new Bot({ id, username, class: wizardClass, behavior, autoEquipOnLevel });
    if (loadout) bot.equippedSpells = [...loadout];

    this.server.players.set(id, bot);
    this.playerIds.add(id);
    this.botControllers.set(id, new BotController(bot, this));

    if (position) {
      bot.spawn(position);
    } else {
      this.spawnPlayer(bot);
    }

    this.server.broadcast(this.id, { type: S2C.PLAYER_JOINED, player: bot.serialize() });
    return bot;
  }

  despawnBot(botId) {
    if (!this.botControllers.has(botId)) return;
    this.botControllers.delete(botId);
    this.playerIds.delete(botId);
    this.server.players.delete(botId);
    this.server.broadcast(this.id, { type: S2C.PLAYER_LEFT, playerId: botId });
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

    // Bots decide + feed input through the exact same path real players use
    for (const controller of this.botControllers.values()) {
      controller.tick(now);
    }

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

    // Resolve windup casts whose delay has elapsed
    this.spellSystem.tickPendingCasts(now);

    // Numeric consequences of status effects (burn DoT, Earth Fossilize on Petrify
    // expiry) — must run BEFORE the generic per-player expiry cleanup below, since
    // that cleanup deletes the very entries this needs to inspect one last time.
    this._tickStatusEffects(now);

    // Tick player status effects (generic expiry cleanup)
    for (const pid of this.playerIds) {
      const player = this.server.players.get(pid);
      if (player) player.tickEffects(now);
    }

    // Auto-resolve any skill-tree fork votes nobody answered in time
    this.progressionSystem.tickVotes(now);

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
    const footwork = player.class === 'sword' && player.unlockedNodes.has('footwork') ? 1.08 : 1;
    const speed = BASE_MOVE_SPEED * speedMult * footwork * this._domainSpeedMultiplier(player);

    // Horizontal movement: Source-engine-style ground/air acceleration (see
    // shared/movement.js) instead of instantly setting velocity to the wish
    // speed -- this gives momentum, ground friction, and (crucially) air
    // strafing, which is what makes bunny hopping possible.
    const yaw = player.yaw;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    let wishX = 0, wishZ = 0;

    if (input.flags & 1)  { wishZ -= cos; wishX -= sin; } // forward
    if (input.flags & 2)  { wishZ += cos; wishX += sin; } // backward
    if (input.flags & 4)  { wishZ += sin; wishX -= cos; } // left
    if (input.flags & 8)  { wishZ -= sin; wishX += cos; } // right

    let wishDir = normalizeWishDir(wishX, wishZ);

    // Stun and freeze/petrify (speedMult 0) lock out movement input entirely
    // (still falls/settles under gravity below).
    const immobilized = player.hasEffect('stun') || speedMult === 0;
    if (immobilized) wishDir = { x: 0, z: 0 };

    if (player.isGrounded) {
      applyGroundFriction(player.velocity, GROUND_FRICTION, STOP_SPEED, dt);
      applyGroundAccel(player.velocity, wishDir, speed, GROUND_ACCEL, dt);
    } else {
      applyAirAccel(player.velocity, wishDir, speed, AIR_ACCEL, AIR_CAP_SPEED, dt);
    }

    // Immobilized is a hard lock, not just a lack of input -- kill any
    // residual horizontal momentum too, rather than letting friction/accel
    // taper it off (matters most in the air, where there's no friction).
    if (immobilized) { player.velocity.x = 0; player.velocity.z = 0; }

    const horizSpeed = Math.hypot(player.velocity.x, player.velocity.z);

    // Earth Bedrock: standing still (grounded, no horizontal drift) for 1.5s grants a damage buff
    if (horizSpeed < 0.05 && player.isGrounded) {
      if (!player.bedrockIdleSince) player.bedrockIdleSince = now;
      player.bedrock = player.unlockedNodes.has('bedrock') && (now - player.bedrockIdleSince) >= 1500;
    } else {
      player.bedrockIdleSince = 0;
      player.bedrock = false;
    }

    // Ice Permafrost: moving leaves a brief slowing frost trail (throttled)
    if (player.class === 'ice' && player.unlockedNodes.has('permafrost') && horizSpeed > 0.05 && now >= player.nextPermafrostAt) {
      player.nextPermafrostAt = now + 400;
      this.spellSystem._spawnPermafrostTrail(player);
    }

    // Event Horizon: pull everyone toward the arena center while active
    this._applyDomainPull(player, dt);

    // Vertical (gravity + jump)
    if (!player.isGrounded) {
      player.velocity.y += GRAVITY * dt;
    }

    // Jump: held JUMP bit auto-bhops off the ground (Source-style
    // sv_autobunnyhop); the double jump only fires on JUMP_EDGE (rising edge
    // of the key, computed client-side) so holding space doesn't burn both
    // charges in the same two ticks it takes to leave the ground.
    if ((input.flags & INPUT_FLAGS.JUMP) && player.isGrounded) {
      player.velocity.y = JUMP_FORCE;
      player.isGrounded = false;
      player.airJumpsUsed = 0;
    } else if (!player.isGrounded && (input.flags & INPUT_FLAGS.JUMP_EDGE) && player.airJumpsUsed < MAX_AIR_JUMPS) {
      player.velocity.y = JUMP_FORCE;
      player.airJumpsUsed++;
    }

    // Integrate position
    player.position.x += player.velocity.x * dt;
    player.position.y += player.velocity.y * dt;
    player.position.z += player.velocity.z * dt;

    // Terrain: push out of walls/platform sides before settling vertically
    // (feetY from the pre-collision integration is close enough for the
    // "already climbed the ramp" step-tolerance check in resolveTerrainCollision).
    const feetYBeforeCollision = player.position.y - PLAYER_HEIGHT;
    const resolved = resolveTerrainCollision(player.position.x, player.position.z, PLAYER_CAPSULE_RADIUS, feetYBeforeCollision);
    player.position.x = resolved.x;
    player.position.z = resolved.z;

    const barrierResolved = resolveCircleObstacles(player.position.x, player.position.z, PLAYER_CAPSULE_RADIUS, this._activeBarrierCircles());
    player.position.x = barrierResolved.x;
    player.position.z = barrierResolved.z;

    // Floor/terrain collision (ramps and platforms raise the walkable surface).
    // Snap to the surface whenever descending and within a small tolerance of
    // it (not just strictly below) so walking down a ramp doesn't stutter/bounce
    // one tick at a time — a real freefall (walking off a platform edge) is a
    // much bigger gap than the tolerance and still falls normally.
    const groundY = PLAYER_HEIGHT + terrainHeightAt(player.position.x, player.position.z);
    const huggingSurface = player.velocity.y <= 0 && (player.position.y - groundY) <= 0.3;
    if (player.position.y <= groundY || huggingSurface) {
      player.position.y = groundY;
      player.velocity.y = 0;
      player.isGrounded = true;
      player.airJumpsUsed = 0;
    } else {
      player.isGrounded = false;
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
    // Frozen and hidden while a skill-tree fork vote is open for them -- see
    // ProgressionSystem._openVote. No movement, no casts, nothing.
    if (player.isChoosingBranch) return;

    // Store latest input for next tick
    player.pendingInput = input;
    player.lastInputSeq = input.seq;
    // Which hotbar slot is selected -- not part of physics sim, applied
    // immediately. Drives the sniper-sight aim line for endgame hitscan
    // spells (see Player.serialize / SniperSightLines.tsx): everyone needs
    // to see it, not just the caster, so it has to be broadcast state.
    if (typeof input.activeSlot === 'number') player.activeSlot = input.activeSlot;

    // Handle spell cast in input
    if (input.cast) {
      this.spellSystem.handleCastRequest(player, input.cast, input.clientTimestamp);
    }

    // Handle mobility
    if (input.mobility) {
      this.spellSystem.handleMobility(player, input);
    }

    // Handle basic attack (RMB) / melee (F) -- universal, outside the equip slots
    if (input.basicAttack) {
      this.spellSystem.handleBasicAttack(player, input.basicAttack.aimDir, input.clientTimestamp);
    }
    if (input.melee) {
      this.spellSystem.handleMelee(player, input.melee.aimDir, input.clientTimestamp);
    }
  }

  applyDamage(targetId, damage, sourceId, spellId, isHeadshot = false) {
    const target = this.server.players.get(targetId);
    if (!target || !target.isAlive) return 0;
    if (target.hasEffect('phase')) return 0;
    if (target.isGodMode) return 0; // Experiment Lab: invulnerable
    if (target.isChoosingBranch) return 0; // hidden + frozen at the fork-choice screen

    // Interrupt an in-progress windup cast (Death Note, Petrify, ...) if it allows it
    if (target.pendingCast?.interruptible) {
      const interruptedSpell = target.pendingCast.spell;
      target.pendingCast = null;
      if (interruptedSpell?.interruptedCooldown != null) {
        target.setCooldown(interruptedSpell.id, interruptedSpell.interruptedCooldown);
        // A once-per-life spell that gets interrupted didn't "happen" — an
        // interruptedCooldown existing at all implies a retry is intended,
        // so don't burn the one-per-life use on a cast that never landed.
        if (interruptedSpell.oncePerLife) target.oncePerLifeUsed.delete(interruptedSpell.id);
      }
    }

    // Apply passive defense modifiers
    let finalDamage = damage;
    const attacker = this.server.players.get(sourceId);
    const now = Date.now();

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

    // Airborne (Fissure): +25% damage taken while launched
    if (target.hasEffect('airborne')) {
      finalDamage *= STATUS_EFFECTS.airborne.damageMultiplier;
    }

    // Hat contact buff: knocking an opponent's hat off grants a temporary damage buff
    if (attacker && attacker.hasEffect('hat_buff')) {
      const tier = attacker.activeEffects.get('hat_buff')?.stacks ?? 0;
      finalDamage *= (1 + (HAT_BUFF_DAMAGE_MULT[tier] ?? 0));
    }

    // Dark Entropy: void-branch spells permanently shrink the target's max HP
    if (attacker?.unlockedNodes.has('entropy') && getSpell(spellId)?.branch === 'void') {
      target.applyVoidDecay(STATUS_EFFECTS.void_decay.maxHpReduction);
    }

    // Fire Combustion: every fire-school hit applies/stacks burn, not just the spells that already do
    if (attacker?.unlockedNodes.has('combustion') && getSpell(spellId)?.school === 'fire') {
      target.applyEffect('burn', 2000, 1, sourceId);
    }

    // Dark Unraveling: void-branch hits refresh/extend a cumulative slow
    if (attacker?.unlockedNodes.has('unraveling') && getSpell(spellId)?.branch === 'void') {
      target.applyEffect('slow', 2000, 1, sourceId);
    }

    // Fire Kindling: Ember Flick hits build stacks (cap 3, 5s decay); stacks buff all of the attacker's fire damage
    if (spellId === 'ember_flick' && attacker?.unlockedNodes.has('kindling')) {
      attacker.kindlingStacks = Math.min(3, attacker.kindlingStacks + 1);
      attacker.kindlingExpiry = now + 5000;
    }
    if (attacker?.unlockedNodes.has('kindling')) {
      if (attacker.kindlingExpiry > now && attacker.kindlingStacks > 0) {
        finalDamage *= (1 + 0.10 * attacker.kindlingStacks);
      } else {
        attacker.kindlingStacks = 0;
      }
    }

    // Earth Tectonic Focus: +15% damage on Avalanche and Fissure
    if (attacker?.unlockedNodes.has('tectonic_focus') && (spellId === 'avalanche' || spellId === 'fissure')) {
      finalDamage *= 1.15;
    }

    // Sword Keen Edge: every 5th spell hit deals double damage
    if (attacker?.unlockedNodes.has('keen_edge')) {
      attacker.keenEdgeCounter = (attacker.keenEdgeCounter + 1) % 5;
      if (attacker.keenEdgeCounter === 0) finalDamage *= 2;
    }

    // Sword Counter: the Iron Edge right after a successful parry hits doubled
    if (spellId === 'iron_edge' && attacker?.empoweredSlashReady) {
      finalDamage *= 2;
      attacker.empoweredSlashReady = false;
    }

    // Ice Flash Freeze: a second ice-school hit within 1.5s of the last briefly freezes the target
    if (attacker?.class === 'ice' && attacker.unlockedNodes.has('flash_freeze') && getSpell(spellId)?.school === 'ice') {
      if (attacker.lastIceSpellCastAt && now - attacker.lastIceSpellCastAt < 1500) {
        target.applyEffect('freeze', 600, 1, sourceId);
      }
      attacker.lastIceSpellCastAt = now;
    }

    // Earth Geologic: stacked defense is consumed (reset) by taking a hit
    if (target.unlockedNodes.has('geologic') && target.geologicStacks > 0) {
      finalDamage *= (1 - 0.05 * target.geologicStacks);
      target.geologicStacks = 0;
    }

    // Earth Bedrock: +20% damage while the standing-still buff is active
    if (attacker?.bedrock) {
      finalDamage *= 1.2;
    }

    // Sword Final Form: during your own The Last Word, every hit is doubled
    const activeDomainForDamage = this.getActiveDomain();
    if (
      activeDomainForDamage?.spellId === 'the_last_word' &&
      activeDomainForDamage.ownerId === sourceId &&
      now >= activeDomainForDamage.activatesAt &&
      attacker?.unlockedNodes.has('final_form')
    ) {
      finalDamage *= 2;
    }

    // Sword Iron Will: -5% incoming damage for 3s after casting a Warlord (Blade Rain branch) spell
    if (target.ironWillExpiry > now) {
      finalDamage *= 0.95;
    }

    // Dark Crimson Veil: brief damage reduction after a vampiric-branch kill
    if (target.crimsonVeilExpiry > now) {
      finalDamage *= 0.8;
    }

    // Freeze breaks on any damage taken (except the hit that's deliberately
    // shattering it — Shatter/Divine Judgement already clear it themselves
    // before this runs, so this only fires for "just tickled a frozen target").
    if (STATUS_EFFECTS.freeze.breakOnDamage && target.hasEffect('freeze')) {
      target.removeEffect('freeze');
    }

    target.health = Math.max(0, target.health - Math.round(finalDamage));
    target.damageTaken += Math.round(finalDamage);

    if (spellId) {
      const logEntry = this.damageLog.get(spellId) ?? { totalDamage: 0, hits: 0 };
      logEntry.totalDamage += Math.round(finalDamage);
      logEntry.hits += 1;
      this.damageLog.set(spellId, logEntry);
    }

    // Track attacker's damage for Death Note / assists
    if (attacker) {
      attacker.damageDealt += Math.round(finalDamage);
      attacker.recordDamageTo(targetId);

      // Sword Inevitable: landing any hit shaves 2s off a cooling-down Sovereign Cut
      if (attacker.unlockedNodes.has('inevitable') && attacker.isOnCooldown('sovereign_cut')) {
        const current = attacker.cooldowns.get('sovereign_cut');
        attacker.cooldowns.set('sovereign_cut', current - 2000);
      }
    }

    // Fire Backdraft: taking damage while Immolate is active triggers a small self-centered explosion (1s internal cooldown)
    if (target.unlockedNodes.has('backdraft') && target.immolateActiveUntil > now && (!target.backdraftReadyAt || now >= target.backdraftReadyAt)) {
      target.backdraftReadyAt = now + 1000;
      this.spellSystem._resolveAoe({
        ownerId: target.id, spellId: 'backdraft', position: { ...target.position },
        radius: 3, damage: 25, statusEffect: null, statusDuration: 0, lifesteal: 0,
      }, now);
    }

    // Fire Solar Flare: landing a hit briefly blinds the target's screen (client-rendered flash)
    if (attacker?.unlockedNodes.has('solar_flare')) {
      target.applyEffect('blind', 500, 1, sourceId);
    }

    // Experiment Lab: live combat log — only for bot-involved fights, since
    // regular PvP already has its own hitmarker/damage-number feedback and
    // doesn't need a second broadcast per hit.
    if (attacker && Math.round(finalDamage) > 0 && (attacker.isBot || target.isBot)) {
      this.server.broadcast(this.id, {
        type: S2C.COMBAT_LOG,
        kind: 'hit',
        sourceId, sourceName: attacker.username, sourceIsBot: !!attacker.isBot,
        targetId, targetName: target.username, targetIsBot: !!target.isBot,
        spellId, damage: Math.round(finalDamage), isHeadshot: !!isHeadshot,
      });
    }

    if (target.health <= 0) {
      this._handleDeath(target, sourceId, spellId);
    }

    return Math.round(finalDamage);
  }

  _handleDeath(player, killerId, killingSpellId = null) {
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
      // Vampiric: Crimson Hunger — burst heal on kill
      if (killer.class === 'dark' && killer.unlockedNodes.has('crimson_hunger')) {
        killer.health = Math.min(killer.maxHealth, killer.health + 40);
      }
      // Vampiric: Crimson Veil — brief incoming-damage reduction after a kill
      if (killer.class === 'dark' && killer.unlockedNodes.has('crimson_veil')) {
        killer.crimsonVeilExpiry = Date.now() + 3000;
      }

      const prevLevel = killer.level;
      killer.xp += XP_PER_KILL;
      killer.level = levelFromXp(killer.xp);
      if (killer.level > prevLevel) {
        // Skill points come from leveling up, not from the kill itself -- a
        // kill that doesn't cross a level threshold grants none, so "level"
        // stays the thing that actually gates progression.
        killer.skillPoints += (killer.level - prevLevel) * POINTS_PER_LEVEL;
        this.server.send(killer, {
          type: S2C.LEVEL_UP,
          level: killer.level,
          rank: rankForLevel(killer.level).name,
          hatGrew: hatBuffTierForLevel(killer.level) > hatBuffTierForLevel(prevLevel),
        });
      }

      // Bots can opt out of auto-spending skill points (Experiment Lab's
      // "auto-equip spells on level" toggle) to stay pinned to their
      // configured loadout for controlled matchup testing; humans always
      // auto-spend.
      if (!killer.isBot || killer.autoEquipOnLevel) {
        this.progressionSystem.tryAutoUnlock(killer);
      }
    }

    this.server.broadcast(this.id, {
      type: S2C.PLAYER_DIED,
      playerId: player.id,
      killerId: killerId ?? null,
      killerName: killer?.username ?? null,
      killerSymbol: killer ? classSymbol(killer.class, killer.divergedBranch) : null,
      victimName: player.username,
      spellId: killingSpellId,
    });

    this.server.broadcast(this.id, {
      type: S2C.KILL_FEED,
      killer: killer?.username ?? 'Arena',
      killerSymbol: killer ? classSymbol(killer.class, killer.divergedBranch) : '',
      victim: player.username,
      victimSymbol: classSymbol(player.class, player.divergedBranch),
      spellId: killingSpellId,
    });

    // Experiment Lab: live combat log with the running head-to-head record
    // between these two -- e.g. "(3-1)" means the killer is now up 3 kills
    // to the victim's 1 against each other specifically, not overall kills.
    if (killer) {
      this.headToHead.set(`${killerId}>${player.id}`, this._h2h(killerId, player.id) + 1);
      if (killer.isBot || player.isBot) {
        this.server.broadcast(this.id, {
          type: S2C.COMBAT_LOG,
          kind: 'kill',
          sourceId: killerId, sourceName: killer.username, sourceIsBot: !!killer.isBot,
          targetId: player.id, targetName: player.username, targetIsBot: !!player.isBot,
          spellId: killingSpellId,
          killerWins: this._h2h(killerId, player.id),
          victimWins: this._h2h(player.id, killerId),
        });
      }
    }

    if (this.respawnEnabled) this.scheduleRespawn(player.id);
  }

  /** Burn's per-tick DoT — the only status effect that deals damage over time on its own clock. */
  _tickStatusEffects(now) {
    for (const pid of this.playerIds) {
      const player = this.server.players.get(pid);
      if (!player || !player.isAlive) continue;

      const burn = player.activeEffects.get('burn');
      if (burn && now >= burn.nextTickAt) {
        burn.nextTickAt = now + STATUS_EFFECTS.burn.tickInterval;
        const dmg = STATUS_EFFECTS.burn.tickDamage * burn.stacks;
        this.applyDamage(pid, dmg, burn.sourceId ?? pid, 'burn');
      }

      // Earth Fossilize: Petrify expiring leaves a lingering slow, if the caster unlocked it
      const petrify = player.activeEffects.get('petrify');
      if (petrify && now > petrify.expiresAt) {
        const caster = this.server.players.get(petrify.sourceId);
        if (caster?.unlockedNodes.has('fossilize')) {
          player.applyEffect('slow', 4000, 1, petrify.sourceId);
        }
      }
    }
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

  /** Movement speed multiplier from the active domain, if any (1 = unaffected). Domains are whole-arena, centered on the origin, matching their existing full-screen fog visual. */
  _domainSpeedMultiplier(player) {
    const domain = this.getActiveDomain();
    if (!domain || Date.now() < domain.activatesAt) return 1;
    const config = DOMAIN_CONFIGS[domain.spellId];
    if (!config) return 1;
    const isOwner = domain.ownerId === player.id;

    switch (domain.spellId) {
      case 'absolute_zero':  return isOwner ? 1 : (config.speedMultiplier ?? 1);
      case 'the_last_word':  return isOwner ? 1 : (config.otherSpeedMultiplier ?? 1);
      case 'terra_domain':   return isOwner ? (config.ownerSpeedMultiplier ?? 1) : (config.otherSpeedMultiplier ?? 1);
      default: return 1;
    }
  }

  /** Event Horizon: nudges velocity toward the arena center each tick while active. */
  _applyDomainPull(player, dt) {
    const domain = this.getActiveDomain();
    if (!domain || domain.spellId !== 'event_horizon' || Date.now() < domain.activatesAt) return;
    const config = DOMAIN_CONFIGS.event_horizon;
    const dx = -player.position.x, dz = -player.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.5) return;
    const pull = (config?.pullForce ?? 0) * dt;
    player.velocity.x += (dx / dist) * pull;
    player.velocity.z += (dz / dist) * pull;
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
        level: p.level,
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

  _serializeBarriers() {
    const out = {};
    for (const [id, b] of this.barriers) out[id] = b;
    return out;
  }

  /** Active barriers as {x,z,radius,baseY,height} circles for movement/ray collision. */
  _activeBarrierCircles() {
    const circles = [];
    for (const [, b] of this.barriers) {
      if (!b.active) continue;
      circles.push({ x: b.position.x, z: b.position.z, radius: b.width / 2, baseY: b.position.y - b.height / 2, height: b.height });
    }
    return circles;
  }

  _broadcastTick(now) {
    // Every recipient needs a different ackSeq spliced in, but the rest of the
    // payload is identical -- serialize the shared part once (this already
    // scales with player+bot count via the per-player serialize() calls
    // below) and append ackSeq per-recipient via string concat instead of
    // parsing and re-stringifying the whole payload for every connection.
    const base = JSON.stringify({
      type: S2C.GAME_TICK,
      tick: this.tick,
      timestamp: now,
      players: this._serializePlayers(),
      projectiles: this._serializeProjectiles(),
      effects: this._serializeEffects(),
      domains: this._serializeDomains(),
      barriers: this._serializeBarriers(),
    });
    const prefix = base.slice(0, -1); // drop trailing '}'

    for (const pid of this.playerIds) {
      const p = this.server.players.get(pid);
      if (p && p.isConnected()) {
        p.ws.send(`${prefix},"ackSeq":${p.lastInputSeq}}`);
      }
    }
  }
}
