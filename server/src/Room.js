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
  CLASSES,
} from 'shared/constants';
import { getSpell, MAX_SPELL_SLOTS, equippableSpellsForClass } from 'shared/spells';
import { XP_PER_KILL, levelFromXp, rankForLevel, hatBuffTierForLevel, HAT_BUFF_DAMAGE_MULT } from 'shared/leveling';
import { terrainHeightAt, resolveTerrainCollision, resolveCircleObstacles } from 'shared/mapLayout';
import { applyGroundFriction, applyGroundAccel, applyAirAccel, normalizeWishDir } from 'shared/movement';
import { STATUS_EFFECTS, DOMAIN_CONFIGS } from 'shared/gameConfig';
import { CLASS_LABEL, classSymbol } from 'shared/classFlavor';

// Opt-in (WW_NETSTATS=1) per-tick serialize cost logging, used to measure the GAME_TICK payload work.
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const NET_STATS = !!process.env.WW_NETSTATS;
const _netStat = { ns: 0, n: 0, bytes: 0 };

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

// Movement input queue (see Room._simulatePlayer): the cap is ~1s of input,
// beyond which the oldest steps are dropped (a real desync, the client snaps).
const MAX_INPUT_QUEUE = 64;
const CATCHUP_BACKLOG = 2;  // queued steps above this => simulate extra steps per tick
const MAX_STEPS_PER_TICK = 4;
const MAX_STEP_CREDIT = 48; // ~0.75s of burst allowance; refills 1 step per tick

const MAX_BOTS_PER_ROOM = 24; // SPAWN_BOTS is open to every player and adds 6 per press -- without a cap one client can bury the tick loop in bots
const ERROR_LOG_INTERVAL_MS = 5000; // a phase that throws every tick would otherwise log 64 stack traces/second
const MATCH_COUNTDOWN_MS = 3000; // grace period after spawning into a single-player match before bots start acting
const DUEL_ELO_K = 32; // standard chess-style K-factor -- how many rating points a single duel can move

/** Yaw (radians) that faces `to` from `from` -- matches the forward vector Room.processInput derives from yaw (-sin(yaw), -cos(yaw)). */
function yawTowards(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

export class Room {
  constructor({ id, server, respawnEnabled = true, matchMode = false }) {
    this.id = id;
    this.server = server;
    this.respawnEnabled = respawnEnabled;
    this.matchMode = matchMode; // true for a private single-player-vs-bots match room -- gates team win-condition checks
    this.matchEnded = false;
    this.teamEliminationOrder = []; // team ids, in the order every one of their members died -- see _maybeEndMatch
    this.countdownEndsAt = null; // ms epoch; bots stay passive until this passes, see BotController.tick and _startCountdown
    this.isDuel = false; // true for a 1v1 Single Player duel (see setupDuel) -- gates the ELO stake calculation in _maybeEndMatch
    this.duelOpponentElo = null;
    this.playerIds = new Set();
    this.projectiles = new Map();  // projectileId → projectile state
    this._projWire = new WeakMap(); // projectile object → ownerId last sent in full/delta form (see _serializeProjectilesDelta)
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
    player.resetWireCache(); // next GAME_TICK re-sends this player's cold fields to everyone
    // Starting points are a one-time grant per fresh session. This used to be
    // an unconditional `= STARTING_SKILL_POINTS` on EVERY join, so spending a
    // point and then re-sending JOIN_ROOM (or bouncing lobby <-> match) handed
    // the spent point straight back -- unlimited skill nodes -- and it also
    // clobbered the balance restored from Redis for a returning player.
    if (!player.startingPointsGranted) {
      player.startingPointsGranted = true;
      if (!player.class) player.skillPoints = STARTING_SKILL_POINTS;
    }

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
    // The vote that froze + hid them (isChoosingBranch) dies with the room;
    // without this they arrived in the next room (or the lab) frozen and
    // invisible with no prompt left to answer.
    const leaving = this.server.players.get(playerId);
    if (leaving) leaving.isChoosingBranch = false;
    this._forget(playerId);
    this._purgeOwnedBy(playerId);
    this.server.broadcast(this.id, { type: S2C.PLAYER_LEFT, playerId });
  }

  /**
   * Removes everything in flight that `ownerId` cast in this room. Their
   * projectiles / beams / airbuds / domains used to keep running after they
   * left, and a hit by one still credited kills + XP to a player who was by
   * then in another room, opening skill votes in THIS room's ProgressionSystem
   * for someone who is not here (a stale entry, and a frozen player there).
   */
  _purgeOwnedBy(ownerId) {
    for (const [id, p] of this.projectiles) if (p.ownerId === ownerId) this.projectiles.delete(id);
    for (const [id, e] of this.effects) if (e.ownerId === ownerId) this.effects.delete(id);
    for (const [id, b] of this.barriers) if (b.ownerId === ownerId) this.barriers.delete(id);
    for (const [id, d] of this.domains) {
      if (d.ownerId !== ownerId) continue;
      this.domains.delete(id);
      this.server.broadcast(this.id, { type: S2C.DOMAIN_END, domainId: id });
    }
  }

  /**
   * Drops per-opponent bookkeeping that names `id`. headToHead is keyed
   * "a>b" and each Player keeps lastDamageTime/recentDamageDealt by target id;
   * in a long-lived room (the lobby) with bots coming and going, every new bot
   * id added entries that were never removed.
   */
  _forget(id) {
    for (const key of this.headToHead.keys()) {
      const sep = key.indexOf('>');
      if (key.slice(0, sep) === id || key.slice(sep + 1) === id) this.headToHead.delete(key);
    }
    for (const pid of this.playerIds) {
      const p = this.server.players.get(pid);
      p?.lastDamageTime.delete(id);
      p?.recentDamageDealt.delete(id);
    }
  }

  /**
   * `position` overrides the round-robin SPAWN_POSITIONS pick -- used by
   * setupMatch()/setupDuel() to cluster teammates. `yaw` optionally sets
   * facing on spawn (same callers, so a match doesn't start with the
   * player staring away from the fight) -- omitted, yaw is left as-is,
   * matching the original lobby-respawn behavior.
   */
  spawnPlayer(player, position = null, yaw = null) {
    const pos = position ?? SPAWN_POSITIONS[this.spawnIndex % SPAWN_POSITIONS.length];
    if (!position) this.spawnIndex++;
    player.spawn({ ...pos });
    if (player.inputQueue) player.inputQueue.length = 0; // pre-death/pre-teleport inputs must not replay on the fresh spawn
    player.spawnedInRoom = this.id;
    if (yaw != null) player.yaw = yaw;
    this.server.broadcast(this.id, {
      type: S2C.PLAYER_RESPAWNED,
      playerId: player.id,
      position: player.position,
      yaw: player.yaw,
    });
  }

  scheduleRespawn(playerId) {
    // One pending auto-respawn per player: a death, a manual respawn and a
    // second death used to leave the first timer behind, which then respawned
    // the player early (skipping the second death's delay).
    this._pendingRespawns = this._pendingRespawns.filter((r) => r.playerId !== playerId);
    this._pendingRespawns.push({ playerId, at: Date.now() + RESPAWN_DELAY });
  }

  /**
   * Tears the room down completely: stops its loop and removes every bot it
   * spawned from the server-wide player registry. Room.stop() alone only
   * stopped the loop, so bots (and their BotControllers) of a closed match /
   * Experiment Lab room stayed in server.players forever.
   */
  destroy() {
    this.loop.stop();
    for (const botId of [...this.botControllers.keys()]) {
      this.botControllers.delete(botId);
      this.server.players.delete(botId);
      this.playerIds.delete(botId);
    }
    this.projectiles.clear();
    this.effects.clear();
    this.barriers.clear();
    this.domains.clear();
    this.lagCompensation.snapshots.length = 0;
    this._pendingRespawns.length = 0;
    this.progressionSystem.pendingVotes.clear();
    this.damageLog.clear();
    this.headToHead.clear();
  }

  /** Real (non-bot) players currently in the room. */
  humanCount() {
    let n = 0;
    for (const pid of this.playerIds) {
      const p = this.server.players.get(pid);
      if (p && !p.isBot) n++;
    }
    return n;
  }

  /**
   * Sets up a private match room for `mode` (see shared/gameModes.js):
   * `humanPlayer` (already added to the room + class-selected by the
   * caller) fills team 0's first slot; every remaining slot across every
   * team is a bot. Teammates spawn clustered around a shared anchor point
   * on the existing SPAWN_POSITIONS ring so teams start near each other.
   */
  setupMatch(mode, humanPlayer) {
    mode.teamSizes.forEach((size, team) => {
      const anchor = SPAWN_POSITIONS[team % SPAWN_POSITIONS.length];
      for (let slot = 0; slot < size; slot++) {
        const jitterX = slot === 0 ? 0 : (Math.random() - 0.5) * 6;
        const jitterZ = slot === 0 ? 0 : (Math.random() - 0.5) * 6;
        const position = { x: anchor.x + jitterX, y: anchor.y, z: anchor.z + jitterZ };
        // Face into the arena (toward center) rather than whatever direction
        // they happened to be looking before the match started.
        const yaw = yawTowards(position, { x: 0, z: 0 });
        if (team === 0 && slot === 0) {
          humanPlayer.team = 0;
          this.spawnPlayer(humanPlayer, position, yaw);
        } else {
          const wizardClass = CLASSES[Math.floor(Math.random() * CLASSES.length)];
          this.spawnBot({ class: wizardClass, behavior: 'aggressive', position, team, yaw });
        }
      }
    });
    this._startCountdown();
  }

  /**
   * Sets up a private 1v1 duel room: `humanPlayer` on team 0, a single bot
   * built from `preset` (see shared/duelOpponents.js) on team 1, loaded out
   * with `preset.spellCount` of its class's equippable spells (lowest tier
   * first). `preset.elo` is stashed for the reputation-stake calculation
   * once the duel ends -- see _maybeEndMatch.
   */
  setupDuel(preset, humanPlayer) {
    this.isDuel = true;
    this.duelOpponentElo = preset.elo;

    const humanPos = SPAWN_POSITIONS[0];
    const botPos = SPAWN_POSITIONS[1];
    // Face each other exactly, not just "into the arena" -- with only two
    // combatants there's no ambiguity about which direction actually matters.
    humanPlayer.team = 0;
    this.spawnPlayer(humanPlayer, humanPos, yawTowards(humanPos, botPos));

    const loadout = equippableSpellsForClass(preset.class).slice(0, preset.spellCount).map((s) => s.id);
    while (loadout.length < MAX_SPELL_SLOTS) loadout.push(null);
    this.spawnBot({ class: preset.class, behavior: preset.behavior, position: botPos, team: 1, loadout, yaw: yawTowards(botPos, humanPos) });

    this._startCountdown();
  }

  /** Grace period after spawning into a single-player match before bots start acting -- see BotController.tick. */
  _startCountdown() {
    this.countdownEndsAt = Date.now() + MATCH_COUNTDOWN_MS;
    this.server.broadcast(this.id, { type: S2C.MATCH_COUNTDOWN, endsAt: this.countdownEndsAt });
  }

  /** Creates and spawns a bot into this room. Returns the Bot instance. */
  spawnBot({ class: wizardClass, behavior = 'aggressive', position = null, yaw = null, loadout = null, autoEquipOnLevel = true, team = null }) {
    if (this.botControllers.size >= MAX_BOTS_PER_ROOM) return null;
    // `position` / `loadout` come straight off the wire for the lab's
    // C2S.SPAWN_BOT: NaN/Infinity/strings here would put a bot at a non-finite
    // position (poisoning every tick) or an arbitrary object into its loadout.
    if (position && !(Number.isFinite(position.x) && Number.isFinite(position.z))) position = null;
    if (position) {
      const r = Math.hypot(position.x, position.z);
      const max = ARENA_RADIUS - 1;
      const k = r > max ? max / r : 1;
      position = { x: position.x * k, y: Number.isFinite(position.y) ? Math.min(Math.max(position.y, PLAYER_HEIGHT), 60) : PLAYER_HEIGHT, z: position.z * k };
    }
    if (loadout) loadout = loadout.map((spellId) => (typeof spellId === 'string' && getSpell(spellId)?.class === wizardClass ? spellId : null));
    const id = `bot-${uuid()}`;
    // "DruidBot_4324" -- names the class so a killfeed/scoreboard entry reads
    // as an actual opponent instead of an anonymous id fragment.
    const namePrefix = CLASS_LABEL[wizardClass] ?? 'Wizard';
    const username = `${namePrefix}Bot_${1000 + Math.floor(Math.random() * 9000)}`;
    const bot = new Bot({ id, username, class: wizardClass, behavior, autoEquipOnLevel, team });
    if (loadout) bot.equippedSpells = [...loadout];

    this.server.players.set(id, bot);
    this.playerIds.add(id);
    this.botControllers.set(id, new BotController(bot, this));

    if (position) {
      bot.spawn(position);
      if (yaw != null) bot.yaw = yaw;
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
    this._forget(botId);
    this._purgeOwnedBy(botId);
    this.server.broadcast(this.id, { type: S2C.PLAYER_LEFT, playerId: botId });
  }

  // ── Main game loop ──────────────────────────────────────────────────────

  update() {
    const now = Date.now();
    const dt = TICK_INTERVAL / 1000; // seconds

    // Nobody here: nothing to simulate or broadcast. The always-on lobby sat
    // here ticking at 64Hz (snapshot + serialize + broadcast to no one) around
    // the clock. World state is dropped so the next arrival doesn't inherit
    // frozen projectiles / half-expired domains.
    if (this.playerIds.size === 0) {
      if (this.projectiles.size || this.effects.size || this.domains.size || this.barriers.size) {
        this.projectiles.clear(); this.effects.clear(); this.domains.clear(); this.barriers.clear();
      }
      this._pendingRespawns.length = 0;
      this.lagCompensation.snapshots.length = 0;
      this.tick++;
      return;
    }

    // Each phase is isolated: a throw in (say) projectile simulation used to
    // abort the whole tick -- including the broadcast -- every single tick
    // thereafter, freezing the room for everyone until a restart.
    this._phase('respawns', () => {
      const remaining = [];
      for (const r of this._pendingRespawns) {
        if (now >= r.at) {
          const p = this.server.players.get(r.playerId);
          // Only respawn someone who is still dead and still HERE: a manual
          // respawn, a room switch or a reconnect (new Player, same id) since
          // the death must not get teleported/healed by a stale timer.
          if (p && !p.isAlive && p.roomId === this.id && this.playerIds.has(p.id)) this.spawnPlayer(p);
        } else {
          remaining.push(r);
        }
      }
      this._pendingRespawns = remaining;
    });

    // Bots decide + feed input through the exact same path real players use
    this._phase('bots', () => {
      for (const controller of this.botControllers.values()) controller.tick(now);
    });

    // Process each player's movement
    this._phase('movement', () => {
      for (const pid of this.playerIds) {
        const player = this.server.players.get(pid);
        if (!player || !player.isAlive) continue;
        this._simulatePlayer(player, dt, now);
      }
    });

    this._phase('projectiles', () => this.spellSystem.tickProjectiles(dt, now));
    this._phase('effects', () => this.spellSystem.tickEffects(dt, now));
    this._phase('pendingCasts', () => this.spellSystem.tickPendingCasts(now));

    // Numeric consequences of status effects (burn DoT, Crystalmancer Fossilize on Petrify
    // expiry) — must run BEFORE the generic per-player expiry cleanup below, since
    // that cleanup deletes the very entries this needs to inspect one last time.
    this._phase('statusEffects', () => this._tickStatusEffects(now));

    // Tick player status effects (generic expiry cleanup) + mana regen
    this._phase('playerEffects', () => {
      for (const pid of this.playerIds) {
        const player = this.server.players.get(pid);
        if (!player) continue;
        player.tickEffects(now);
        if (player.isAlive) player.regenMana(dt);
      }
    });

    // Auto-resolve any skill-tree fork votes nobody answered in time
    this._phase('votes', () => this.progressionSystem.tickVotes(now));

    // Save snapshot for lag compensation
    this._phase('snapshot', () => this.lagCompensation.save(this.tick, now, this._snapshotState()));

    // Broadcast authoritative state
    this.tick++;
    this._phase('broadcast', () => this._broadcastTick(now));
  }

  /** Runs one tick phase; a throw is logged (rate-limited) and the rest of the tick still happens. */
  _phase(name, fn) {
    try {
      fn();
    } catch (e) {
      const t = Date.now();
      if (!this._lastPhaseErrorAt || t - this._lastPhaseErrorAt > ERROR_LOG_INTERVAL_MS) {
        this._lastPhaseErrorAt = t;
        console.error(`[GameLoop] Tick error in room ${this.id} (${name} phase):`, e);
      }
    }
  }

  /**
   * Consumes queued movement inputs for this tick. Each client input is one
   * fixed 1/TICK_RATE step (CameraController sends exactly one per predicted
   * step), so simulating exactly one step per input -- never skipping or
   * overwriting one -- is what keeps this identical to the client's
   * prediction/reconcile replay. The old single `pendingInput` slot dropped
   * every input but the newest whenever two arrived in the same tick
   * (ordinary network jitter) and simulated nothing on a tick with none, so
   * the server walked a different number of steps than the client predicted
   * and the player rubber-banded constantly under latency.
   *
   * Normally one input per tick. After a stall (a TCP head-of-line hiccup
   * delivering a burst) it catches up a few steps per tick, bounded by a
   * step-credit bucket that refills 1/tick so a flooding client can't exceed
   * the real-time movement speed on average (speed hack guard).
   */
  _simulatePlayer(player, dt, now) {
    // Credit accrues every tick (even starved ones), so a stall's worth of
    // credit is there to drain the burst that follows it.
    player.stepCredit = Math.min(MAX_STEP_CREDIT, (player.stepCredit ?? MAX_STEP_CREDIT) + 1);
    const queue = player.inputQueue;
    if (!queue || queue.length === 0) return;
    const backlog = queue.length;
    const want = backlog > CATCHUP_BACKLOG ? Math.min(backlog - 1, MAX_STEPS_PER_TICK) : 1;
    const steps = Math.min(want, player.stepCredit);
    for (let i = 0; i < steps; i++) {
      const input = queue.shift();
      player.stepCredit--;
      this._stepPlayer(player, input, dt, now);
      player.lastInputSeq = input.seq; // ack = last input actually simulated, not merely received
      if (!player.isAlive) { queue.length = 0; break; }
    }
  }

  _stepPlayer(player, input, dt, now) {
    // Mobility (Shift) resolves here, at its place in the input stream, rather
    // than when the packet arrives, so the dash/launch lands between exactly
    // the same two movement steps the client predicted it between.
    if (input.mobility) this.spellSystem.handleMobility(player, input);

    const speedMult = player.getSpeedMultiplier();
    const footwork = player.class === 'sword' && player.unlockedNodes.has('footwork') ? 1.08 : 1;
    const speed = BASE_MOVE_SPEED * speedMult * footwork * this._domainSpeedMultiplier(player);

    // Horizontal movement: Source-engine-style ground/air acceleration (see
    // shared/movement.js) instead of instantly setting velocity to the wish
    // speed -- this gives momentum, ground friction, and (crucially) air
    // strafing, which is what makes bunny hopping possible.
    // This input's yaw, not the previous step's -- the client predicts each
    // step with the yaw it sent in the same input, so using last step's
    // (player.yaw lagged one input behind) rotated the wish direction by one
    // step's worth of mouse turn on every step while turning.
    const yaw = input.yaw;
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

    // Druid Rooted: standing still (grounded, no horizontal drift) for 1.5s grants a damage buff
    if (horizSpeed < 0.05 && player.isGrounded) {
      if (!player.bedrockIdleSince) player.bedrockIdleSince = now;
      player.bedrock = player.unlockedNodes.has('rooted') && (now - player.bedrockIdleSince) >= 1500;
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

  /**
   * Coerces one untrusted PLAYER_INPUT into a well-typed input, or null to
   * drop it. Everything downstream (movement, projectile spawn, aoe placement,
   * beam direction) does arithmetic on these fields and then broadcasts the
   * result, so a single NaN/Infinity/string -- trivially sendable, JSON `1e999`
   * parses to Infinity -- would put non-finite numbers into the world state
   * and into every client's GAME_TICK (JSON turns them into null).
   */
  _sanitizeInput(player, input) {
    if (!input || typeof input !== 'object') return null;
    const fin = (v) => typeof v === 'number' && Number.isFinite(v);
    const unitVec = (v) => {
      if (!v || typeof v !== 'object' || !fin(v.x) || !fin(v.y) || !fin(v.z)) return null;
      const len = Math.hypot(v.x, v.y, v.z);
      if (!(len > 1e-6) || !Number.isFinite(len)) return null;
      return { x: v.x / len, y: v.y / len, z: v.z / len };
    };
    const now = Date.now();
    const out = {
      seq: input.seq,
      // Wire timestamps feed lag-compensation rewind and are stored on projectiles.
      // The client sends `ts` (its clock-synced server time); `clientTimestamp`
      // is the older name, still accepted.
      clientTimestamp: fin(input.ts) ? input.ts : fin(input.clientTimestamp) ? input.clientTimestamp : now,
      // Server time the client was rendering remote players at when it sent
      // this (EntityInterpolation.renderTime) -- see SpellSystem._lagCompTime.
      viewTs: fin(input.viewTs) ? input.viewTs : null,
      flags: fin(input.flags) ? (Math.trunc(input.flags) & 0xff) : 0,
      yaw: fin(input.yaw) && Math.abs(input.yaw) < 1e6 ? input.yaw : player.yaw,
      pitch: fin(input.pitch) ? Math.max(-Math.PI / 2, Math.min(Math.PI / 2, input.pitch)) : player.pitch,
      cast: null,
      mobility: input.mobility === true,
      defensive: input.defensive === true,
      basicAttack: null,
      melee: null,
      activeSlot: Number.isInteger(input.activeSlot) && input.activeSlot >= 0 && input.activeSlot < MAX_SPELL_SLOTS ? input.activeSlot : undefined,
      mobilityForced: false, // server-internal (Undying); never accepted off the wire
    };
    if (!fin(out.seq)) return null;

    const c = input.cast;
    if (c && typeof c === 'object') {
      const aimDir = unitVec(c.aimDir);
      if (typeof c.spellId === 'string' && Number.isInteger(c.slotIndex) && c.slotIndex >= 0 && c.slotIndex < MAX_SPELL_SLOTS && aimDir) {
        out.cast = { spellId: c.spellId, slotIndex: c.slotIndex, aimDir, targetId: typeof c.targetId === 'string' ? c.targetId : undefined };
      }
    }
    for (const key of ['basicAttack', 'melee']) {
      const a = input[key];
      const aimDir = a && typeof a === 'object' ? unitVec(a.aimDir) : null;
      if (aimDir) out[key] = { aimDir };
    }
    return out;
  }

  processInput(player, input) {
    input = this._sanitizeInput(player, input);
    if (!input) return;

    // Frozen and hidden while a skill-tree fork vote is open for them -- see
    // ProgressionSystem._openVote. No movement, no casts, nothing.
    if (player.isChoosingBranch) return;

    // Queue the movement step; the sim consumes it on a later tick (see
    // _simulatePlayer). A dead player's inputs (in flight when they died) are
    // acked but not queued, so they can't replay on top of the respawn.
    if (player.isAlive) {
      const queue = (player.inputQueue ??= []);
      queue.push(input);
      if (queue.length > MAX_INPUT_QUEUE) queue.shift();
    } else {
      player.lastInputSeq = input.seq;
    }
    // Which hotbar slot is selected -- not part of physics sim, applied
    // immediately. Drives the sniper-sight aim line for endgame hitscan
    // spells (see Player.serialize / SniperSightLines.tsx): everyone needs
    // to see it, not just the caster, so it has to be broadcast state.
    if (typeof input.activeSlot === 'number') player.activeSlot = input.activeSlot;
    if (input.viewTs != null) player.lastViewTs = input.viewTs;

    // Handle spell cast in input
    if (input.cast) {
      this.spellSystem.handleCastRequest(player, input.cast, input.clientTimestamp);
    }

    // Mobility (Shift) is deferred to _stepPlayer, see there.

    // Handle defensive spell (Q)
    if (input.defensive) {
      this.spellSystem.handleDefensive(player);
    }

    // Handle basic attack (RMB) / melee (F) -- universal, outside the equip slots
    if (input.basicAttack) {
      this.spellSystem.handleBasicAttack(player, input.basicAttack.aimDir, input.clientTimestamp);
    }
    if (input.melee) {
      this.spellSystem.handleMelee(player, input.melee.aimDir, input.clientTimestamp);
    }
  }

  applyDamage(targetId, damage, sourceId, spellId, isHeadshot = false, bypassDefense = false) {
    // A NaN/Infinity/negative damage value would set health to NaN (which
    // `health <= 0` never catches, leaving an immortal, unserializable
    // player) or heal the target.
    if (!Number.isFinite(damage) || damage < 0) return 0;
    const target = this.server.players.get(targetId);
    if (!target || !target.isAlive) return 0;
    if (target.hasEffect('phase')) return 0;
    if (target.isGodMode) return 0; // Experiment Lab: invulnerable
    if (target.isChoosingBranch) return 0; // hidden + frozen at the fork-choice screen

    // Friendly fire: no-op damage between two different players sharing a
    // non-null team (see shared/gameModes.js / Room.setupMatch). Lobby and
    // Experiment Lab players are never on a team (team stays null), so this
    // never affects normal free-for-all combat.
    if (sourceId !== targetId) {
      const sourcePlayerForTeam = this.server.players.get(sourceId);
      if (sourcePlayerForTeam && sourcePlayerForTeam.team != null && sourcePlayerForTeam.team === target.team) return 0;
    }

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

    // Druid: Thick Bark passive
    if (target.class === 'druid' && target.unlockedNodes.has('thick_bark')) {
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

    // Crystalmancer Resonance: consecutive crystal-spell hits build stacks (cap 3, 5s decay); stacks buff all of the attacker's crystal damage
    if (attacker?.unlockedNodes.has('resonance') && getSpell(spellId)?.school === 'crystalmancer') {
      attacker.resonanceStacks = Math.min(3, attacker.resonanceStacks + 1);
      attacker.resonanceExpiry = now + 5000;
    }
    if (attacker?.unlockedNodes.has('resonance')) {
      if (attacker.resonanceExpiry > now && attacker.resonanceStacks > 0) {
        finalDamage *= (1 + 0.10 * attacker.resonanceStacks);
      } else {
        attacker.resonanceStacks = 0;
      }
    }

    // Druid Feral Focus: +15% damage on Avalanche and Fissure
    if (attacker?.unlockedNodes.has('feral_focus') && (spellId === 'avalanche' || spellId === 'fissure')) {
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

    // Crystalmancer Geologic: stacked defense is consumed (reset) by taking a hit
    if (target.unlockedNodes.has('geologic') && target.geologicStacks > 0) {
      finalDamage *= (1 - 0.05 * target.geologicStacks);
      target.geologicStacks = 0;
    }

    // Druid Rooted: +20% damage while the standing-still buff is active
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

    // Defensive spell (Q) -- checked against the fully modified damage, so it
    // reads as "the actual hit" same as every reduction above. bypassDefense
    // is set on a reflected counter-hit so a full-counter can't chain into
    // itself if both players happen to be countering at once.
    if (!bypassDefense && target.defensiveActive) {
      if (now < target.defensiveExpiry) {
        if (target.defensiveMode === 'counter') {
          target.defensiveActive = false;
          const reflected = Math.round(finalDamage);
          if (attacker && sourceId !== targetId && reflected > 0) {
            this.applyDamage(sourceId, reflected, targetId, spellId, false, true);
          }
          return 0;
        }
        if (target.defensiveMode === 'absorb') {
          const absorbed = Math.min(target.defensiveAbsorbRemaining, finalDamage);
          target.defensiveAbsorbRemaining -= absorbed;
          finalDamage -= absorbed;
          if (target.defensiveAbsorbRemaining <= 0) target.defensiveActive = false;
          if (finalDamage <= 0) return 0;
        } else if (target.defensiveMode === 'reduction') {
          finalDamage *= (1 - target.defensiveDamageReduction);
        }
      } else {
        target.defensiveActive = false; // lazy expiry cleanup
      }
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

    // Dying to your own damage (self-hit AoE, reflected counter, dash into your
    // own trail) is not a kill: no kill count, XP, level-ups or heal-on-kill.
    // playerIds.has: only credit someone who is still in THIS room (see _purgeOwnedBy).
    const killer = killerId === player.id || !this.playerIds.has(killerId) ? null : this.server.players.get(killerId);
    if (killer) {
      killer.kills++;
      // Vampiric: Crimson Hunger — burst heal on kill
      if (killer.isAlive && killer.class === 'dark' && killer.unlockedNodes.has('crimson_hunger')) {
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
        killer.recalcMana();
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
        this.server.persistPlayer(killer);
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
      killerId: killer ? killerId : null,
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
    if (this.matchMode) this._maybeEndMatch();
  }

  /**
   * Match rooms (see Room.setupMatch) end the moment at most one distinct
   * team still has a living member -- respawnEnabled is false for these
   * rooms, so "alive" only shrinks, never grows, across the room's life.
   * Also tracks the order teams get fully wiped in (teamEliminationOrder),
   * so the client can render a full podium/standings, not just win-or-lose.
   */
  _maybeEndMatch() {
    if (this.matchEnded) return;
    const aliveTeams = new Set();
    const allTeams = new Set();
    for (const pid of this.playerIds) {
      const p = this.server.players.get(pid);
      if (!p) continue;
      allTeams.add(p.team);
      if (p.isAlive) aliveTeams.add(p.team);
    }

    // A team that just lost its last living member is "eliminated" -- record
    // it the moment it happens (not just at match end) so teams are ranked
    // by how long they survived, not left in whatever order Set iteration
    // happens to produce.
    for (const team of allTeams) {
      if (!aliveTeams.has(team) && !this.teamEliminationOrder.includes(team)) {
        this.teamEliminationOrder.push(team);
      }
    }

    if (aliveTeams.size <= 1) {
      this.matchEnded = true;
      const winningTeam = aliveTeams.size === 1 ? [...aliveTeams][0] : null;

      // Podium order: the winning team (if any) first, then every eliminated
      // team from most-recently-wiped to first-wiped (survived longest to
      // shortest).
      const standings = [];
      if (winningTeam !== null) standings.push(winningTeam);
      for (let i = this.teamEliminationOrder.length - 1; i >= 0; i--) {
        const team = this.teamEliminationOrder[i];
        if (team !== winningTeam) standings.push(team);
      }

      const players = [...this.playerIds]
        .map((pid) => this.server.players.get(pid))
        .filter(Boolean)
        .map((p) => ({
          id: p.id,
          username: p.username,
          class: p.class,
          team: p.team,
          isBot: !!p.isBot,
          kills: p.kills,
          damageDealt: Math.round(p.damageDealt),
          isAlive: p.isAlive,
        }));

      // Duel reputation stake: standard chess-style expected-score formula
      // against the opponent's fixed preset rating (see
      // shared/duelOpponents.js) -- beating a higher-rated opponent gains
      // more than beating a lower-rated one, and the reverse on a loss.
      let elo = null;
      if (this.isDuel) {
        const human = players.find((p) => !p.isBot);
        const humanPlayer = human ? this.server.players.get(human.id) : null;
        if (humanPlayer) {
          const eloBefore = humanPlayer.elo;
          const expected = 1 / (1 + Math.pow(10, (this.duelOpponentElo - eloBefore) / 400));
          const score = winningTeam === null ? 0.5 : (winningTeam === humanPlayer.team ? 1 : 0);
          const delta = Math.round(DUEL_ELO_K * (score - expected));
          humanPlayer.elo = Math.max(100, eloBefore + delta);
          this.server.persistPlayer(humanPlayer);
          elo = { eloBefore, eloAfter: humanPlayer.elo, eloDelta: humanPlayer.elo - eloBefore, opponentElo: this.duelOpponentElo };
        }
      }

      this.server.broadcast(this.id, { type: S2C.MATCH_END, winningTeam, standings, players, elo });
    }
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

      // Crystalmancer Fossilize: Petrify expiring leaves a lingering slow, if the caster unlocked it
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
      case 'wildwood_domain':
      case 'prism_field':    return isOwner ? (config.ownerSpeedMultiplier ?? 1) : (config.otherSpeedMultiplier ?? 1);
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

  /**
   * One lag-compensation frame. LagCompensation.rayCast only ever reads
   * position / isAlive / level, so that is all that is kept -- this used to
   * deep-copy every player's velocity, health, effect Map AND every live
   * projectile 64 times a second, then retain 32 of those frames, which was
   * the biggest source of per-tick garbage in the room.
   */
  _snapshotState() {
    const players = {};
    for (const pid of this.playerIds) {
      const p = this.server.players.get(pid);
      if (p) {
        players[pid] = {
          position: { x: p.position.x, y: p.position.y, z: p.position.z },
          isAlive: p.isAlive,
          level: p.level,
        };
      }
    }
    return { players };
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

  /**
   * Projectiles for GAME_TICK: the first tick a projectile exists it goes out
   * in full (static fields: spellId, damage, radius, status, timestamps...);
   * afterwards only the fields the sim mutates (position, velocity, and
   * ownerId when a reflect flipped it). The client merges by id.
   */
  _serializeProjectilesDelta() {
    const out = {};
    for (const [id, p] of this.projectiles) {
      const sentOwner = this._projWire.get(p);
      const position = { x: r3(p.position.x), y: r3(p.position.y), z: r3(p.position.z) };
      const velocity = { x: r2(p.velocity.x), y: r2(p.velocity.y), z: r2(p.velocity.z) };
      if (sentOwner === undefined) {
        out[id] = { ...p, position, velocity };
        this._projWire.set(p, p.ownerId);
      } else if (sentOwner !== p.ownerId) {
        out[id] = { position, velocity, ownerId: p.ownerId };
        this._projWire.set(p, p.ownerId);
      } else {
        out[id] = { position, velocity };
      }
    }
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

  /**
   * Per-tick delta payload. Wire format (S2C.GAME_TICK, `delta: true`):
   *   players[pid]  hot fields for every player (position, yaw, pitch, velocity,
   *                 health, mana, isAlive, activeSlot, activeEffects, the
   *                 active-slot cooldown, and the isChoosingBranch /
   *                 defensiveActive / parryActive flags when true) PLUS any
   *                 cold-shared fields (id, username, class, team, loadout,
   *                 level, kills, elo, ping, bot settings...) that changed
   *                 since they were last sent. The client MERGES this into its
   *                 existing player object instead of replacing it.
   *   self          owner-only: full cooldowns plus any changed progression
   *                 (skillPoints, xp, divergedBranch, unlockedNodes,
   *                 revealedLore). Spliced in per recipient; merged into
   *                 players[<own id>] by the client.
   * ROOM_STATE / PLAYER_JOINED still carry full serialize() objects (no
   * `delta` flag => replace), and a (re)joining player's wire cache is reset
   * so its cold fields go out to everyone on the next tick.
   * Every recipient needs a different ackSeq and `self`, but the rest of the
   * payload is identical -- stringify the shared part once and splice the
   * per-recipient tail on via string concat.
   */
  _broadcastTick(now) {
    const t0 = NET_STATS ? process.hrtime.bigint() : 0n;
    const players = {};
    for (const pid of this.playerIds) {
      const p = this.server.players.get(pid);
      if (!p) continue;
      const hot = p.serializeHot();
      const cd = p.cooldownsForWire(false);
      for (const _ in cd) { hot.cooldowns = cd; break; }
      const cold = p.coldDelta();
      players[pid] = cold ? Object.assign(hot, cold) : hot;
    }
    const base = JSON.stringify({
      type: S2C.GAME_TICK,
      delta: true,
      tick: this.tick,
      timestamp: now,
      players,
      projectiles: this._serializeProjectilesDelta(),
      effects: this._serializeEffects(),
      domains: this._serializeDomains(),
      barriers: this._serializeBarriers(),
    });
    const prefix = base.slice(0, -1); // drop trailing '}'
    if (NET_STATS) {
      _netStat.ns += Number(process.hrtime.bigint() - t0);
      _netStat.n++;
      _netStat.bytes += base.length;
    }

    for (const pid of this.playerIds) {
      const p = this.server.players.get(pid);
      if (p && p.isConnected()) {
        const self = p.ownerDelta() ?? {};
        self.cooldowns = p.cooldownsForWire(true);
        const t1 = NET_STATS ? process.hrtime.bigint() : 0n;
        const tail = `,"self":${JSON.stringify(self)},"ackSeq":${p.lastInputSeq}}`;
        if (NET_STATS) _netStat.ns += Number(process.hrtime.bigint() - t1);
        p.ws.send(prefix + tail);
        if (NET_STATS) _netStat.bytes += tail.length - 1;
      }
    }
    if (NET_STATS && _netStat.n >= 320) {
      console.error(`[netstats] room=${this.id} serialize+stringify avg ${(_netStat.ns / _netStat.n / 1e6).toFixed(3)} ms/tick, ${Math.round(_netStat.bytes / _netStat.n)} B/tick shared part`);
      _netStat.ns = 0; _netStat.n = 0; _netStat.bytes = 0;
    }
  }
}
