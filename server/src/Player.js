import { PLAYER_MAX_HEALTH, BASE_MOVE_SPEED, PLAYER_HEIGHT, RESPAWN_DELAY, DEATH_NOTE_DAMAGE_WINDOW } from 'shared/constants';
import { DEFAULT_EQUIPPED, MOBILITY_SPELL, DEFENSIVE_SPELL, MAX_SPELL_SLOTS } from 'shared/spells';
import { STATUS_EFFECTS } from 'shared/gameConfig';
import { maxManaFor, manaRegenFor } from 'shared/leveling';

export class Player {
  constructor({ id, ws, username }) {
    this.id = id;
    this.ws = ws;
    this.username = username ?? `Wizard_${id.slice(0, 4)}`;
    this.isLocalConnection = false; // set by GameServer.onConnection; gates Experiment Lab features
    this.isGodMode = false; // Experiment Lab: invulnerable + untargetable
    this.isDebugMode = false; // set once via C2S.DEBUG_GRANT -- skips every cooldown check (see SpellSystem)

    // State
    this.class = null;
    this.team = null; // match-scoped team id (see Room.setupMatch) -- null means "no team, hostile to everyone" (lobby/experiment rooms)
    this.isAlive = false;
    this.health = PLAYER_MAX_HEALTH;
    this.maxHealth = PLAYER_MAX_HEALTH;
    this.mana = 0;
    this.maxMana = 0;
    this.skillPoints = 0;
    this.xp = 0;
    this.level = 1;
    this.elo = 1000; // 1v1 duel reputation rating -- see Room._maybeEndMatch's duel branch
    this.divergedBranch = {}; // branchGroup -> chosen branch id
    this.unlockedNodes = new Set();
    // Glossary lore entries revealed by spending a skill point on knowledge
    // rather than an actual skill-tree unlock -- see C2S.REVEAL_LORE. Distinct
    // from unlockedNodes: a spell can be "known" (lore visible) without being
    // equippable, e.g. to preview what's ahead in the tree.
    this.revealedLore = new Set();
    this.oncePerLifeUsed = new Set(); // e.g. 'death_note', 'phoenix'

    // Position / physics (server-side authoritative)
    this.position = { x: 0, y: PLAYER_HEIGHT, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.isGrounded = false;
    this.airJumpsUsed = 0; // double jump: refreshed to 0 whenever grounded

    // Spells
    this.equippedSpells = Array(MAX_SPELL_SLOTS).fill(null); // up to 10 active slots, opened as spells unlock
    this.activeSlot = 0; // currently selected hotbar slot -- drives the sniper-sight aim line
    this.mobilitySpell = null;
    this.defensiveSpell = null;
    this.cooldowns = new Map(); // spellId → expiry timestamp

    // Defensive spell (Q) state -- mirrors the ad-hoc parry fields below
    // rather than activeEffects, since it needs a "consume on hit" primitive
    // activeEffects doesn't have. Exactly one of these is active at a time,
    // per player, per DEFENSIVE_SPELLS' three mechanical flavors -- see
    // Room.applyDamage for how each mode is resolved.
    this.defensiveActive = false;
    this.defensiveExpiry = 0;
    this.defensiveMode = null; // 'reduction' | 'absorb' | 'counter'
    this.defensiveDamageReduction = 0; // 'reduction' mode: 0-1 fraction
    this.defensiveAbsorbRemaining = 0; // 'absorb' mode: HP pool left

    // Status effects
    this.activeEffects = new Map(); // effectType → { expiresAt, stacks }

    // Phantoms / mirrors (sword phantom blade)
    this.phantomCasts = 0;

    // Stats for skill point calculation
    this.kills = 0;
    this.assists = 0;
    this.damageDealt = 0;
    this.damageTaken = 0;

    // Lag compensation: map of targetId → last hit timestamp
    this.recentDamageDealt = new Map(); // targetId → timestamp

    // Death note: track last damage to each target
    this.lastDamageTime = new Map(); // targetId → serverTimestamp

    // Networking
    this.lastInputSeq = 0;
    this.lastAckedSeq = 0;
    this.clockOffset = 0; // estimated offset from NTP sync
    this.rtt = 100; // estimated round-trip time ms
    this.ping = 50;
    this.isBot = false;

    // Parry state
    this.parryActive = false;
    this.parryExpiry = 0;
    this.lastParryTime = 0;
    this.lastParriedBy = null; // id of whoever was just parried — Riposte's teleport target

    // Passive counters
    this.keenEdgeCounter = 0; // sword: every 5th hit deals double
    this.geologicStacks = 0; // crystalmancer: defense stacks per cast while below 4, resets on taking a hit
    this.kindlingStacks = 0; // fire: damage buff after Ember Flick
    this.kindlingExpiry = 0;
    this.resonanceStacks = 0; // crystalmancer: damage buff after consecutive crystal-spell hits
    this.resonanceExpiry = 0;
    this.immolateActiveUntil = 0; // fire: Immolate self-aura window, for Backdraft
    this.backdraftReadyAt = 0;
    this.bedrock = false; // druid: standing still buff (true once the 1.5s idle timer has elapsed) -- field name predates the Rooted rename
    this.bedrockIdleSince = 0; // druid: timestamp movement last stopped
    this.lastIceSpellCastAt = 0; // ice: flash_freeze — two ice spells within 1.5s
    this.nextPermafrostAt = 0; // ice: permafrost frost-trail tick timer
    this.ironWillExpiry = 0; // sword: -5% damage taken after a Warlord (blade_rain branch) spell
    this.crimsonVeilExpiry = 0; // dark: brief damage reduction after a vampiric kill
    this.hasAbyssFreeCast = false; // dark: next spell after Null Gaze is free + instant
    this.sovereignCutReadyBonus = 0; // sword: ms shaved off Sovereign Cut's cooldown by inevitable
    this.empoweredSlashReady = false; // sword: Counter — next Iron Edge after a parry is doubled

    // Phase slip state (dark)
    this.isPhasing = false;
    this.phaseExpiry = 0;

    // Windup-cast in progress (death_note, petrify, cryo_lance, siege_blade, the_monolith, ...)
    // { spellId, spell, aimDir, targetId, clientTimestamp, readyAt, interruptible }
    this.pendingCast = null;

    // True while a skill-tree fork vote is open for this player -- input is
    // ignored and the player is hidden from the arena (see Room.processInput
    // / RemotePlayer.tsx) until they resolve it. See ProgressionSystem._openVote.
    this.isChoosingBranch = false;
  }

  /** Subset of state worth surviving a disconnect -- see GameServer.persistPlayer. */
  toPersisted() {
    return {
      username: this.username,
      class: this.class,
      level: this.level,
      xp: this.xp,
      skillPoints: this.skillPoints,
      unlockedNodes: [...this.unlockedNodes],
      revealedLore: [...this.revealedLore],
      divergedBranch: { ...this.divergedBranch },
      equippedSpells: [...this.equippedSpells],
      mobilitySpell: this.mobilitySpell,
      defensiveSpell: this.defensiveSpell,
      kills: this.kills,
      elo: this.elo,
    };
  }

  /** Restore a previous session's saved state onto this (freshly-connected) Player. */
  restoreFrom(persisted) {
    if (!persisted) return;
    this.username = persisted.username ?? this.username;
    this.class = persisted.class ?? null;
    this.level = persisted.level ?? 1;
    this.xp = persisted.xp ?? 0;
    this.skillPoints = persisted.skillPoints ?? 0;
    this.unlockedNodes = new Set(persisted.unlockedNodes ?? []);
    this.revealedLore = new Set(persisted.revealedLore ?? []);
    this.divergedBranch = { ...(persisted.divergedBranch ?? {}) };
    if (Array.isArray(persisted.equippedSpells)) this.equippedSpells = [...persisted.equippedSpells];
    this.mobilitySpell = persisted.mobilitySpell ?? null;
    this.defensiveSpell = persisted.defensiveSpell ?? null;
    this.kills = persisted.kills ?? 0;
    this.elo = persisted.elo ?? 1000;
  }

  selectClass(className) {
    this.class = className;
    this.equippedSpells = [...DEFAULT_EQUIPPED[className]];
    this.mobilitySpell = MOBILITY_SPELL[className];
    this.defensiveSpell = DEFENSIVE_SPELL[className];
    this.divergedBranch = {};
    // Auto-unlock default spells so they can be re-equipped after unequipping
    for (const spellId of this.equippedSpells) {
      if (spellId) this.unlockedNodes.add(spellId);
    }
    this.maxMana = maxManaFor(this.class, this.level);
    this.mana = this.maxMana;
  }

  /** Recompute mana capacity for the current class/level -- called on level up. Capacity only grows, so this never costs the player mana. */
  recalcMana() {
    this.maxMana = maxManaFor(this.class, this.level);
    this.mana = Math.min(this.mana, this.maxMana);
  }

  regenMana(dt) {
    if (!this.class) return;
    this.mana = Math.min(this.maxMana, this.mana + manaRegenFor(this.class, this.level) * dt);
  }

  hasMana(cost) {
    return this.mana >= cost;
  }

  spendMana(cost) {
    this.mana = Math.max(0, this.mana - cost);
  }

  spawn(position) {
    this.isAlive = true;
    this.health = this.maxHealth;
    this.mana = this.maxMana;
    this.position = { ...position };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.airJumpsUsed = 0;
    this.activeEffects.clear();
    this.oncePerLifeUsed.clear();
    this.parryActive = false;
    this.lastParryTime = 0;
    this.lastParriedBy = null;
    this.defensiveActive = false;
    this.defensiveExpiry = 0;
    this.defensiveMode = null;
    this.defensiveDamageReduction = 0;
    this.defensiveAbsorbRemaining = 0;
    this.isPhasing = false;
    this.phantomCasts = 0;
    this.keenEdgeCounter = 0;
    this.geologicStacks = 0;
    this.kindlingStacks = 0;
    this.kindlingExpiry = 0;
    this.immolateActiveUntil = 0;
    this.backdraftReadyAt = 0;
    this.bedrock = false;
    this.bedrockIdleSince = 0;
    this.lastIceSpellCastAt = 0;
    this.nextPermafrostAt = 0;
    this.ironWillExpiry = 0;
    this.crimsonVeilExpiry = 0;
    this.hasAbyssFreeCast = false;
    this.isChoosingBranch = false;
    this.sovereignCutReadyBonus = 0;
    this.empoweredSlashReady = false;
    this.pendingCast = null;
    // clear per-life cooldowns
    this.cooldowns.delete('death_note');
  }

  isConnected() {
    return !!this.ws && this.ws.readyState === 1;
  }

  isOnCooldown(spellId) {
    const expiry = this.cooldowns.get(spellId);
    return expiry ? Date.now() < expiry : false;
  }

  setCooldown(spellId, durationSec) {
    this.cooldowns.set(spellId, Date.now() + durationSec * 1000);
  }

  getCooldownRemaining(spellId) {
    const expiry = this.cooldowns.get(spellId);
    if (!expiry) return 0;
    return Math.max(0, expiry - Date.now());
  }

  applyEffect(effectType, duration, stacks = 1, sourceId = null) {
    const existing = this.activeEffects.get(effectType);
    const newExpiry = Date.now() + duration;
    const newStacks = existing ? Math.min(existing.stacks + stacks, 3) : stacks;
    const entry = { expiresAt: newExpiry, stacks: newStacks, sourceId: sourceId ?? existing?.sourceId ?? null };
    if (effectType === 'burn') {
      entry.nextTickAt = existing?.nextTickAt ?? (Date.now() + STATUS_EFFECTS.burn.tickInterval);
    }
    this.activeEffects.set(effectType, entry);
  }

  hasEffect(effectType) {
    const e = this.activeEffects.get(effectType);
    if (!e) return false;
    if (Date.now() > e.expiresAt) {
      this.activeEffects.delete(effectType);
      return false;
    }
    return true;
  }

  removeEffect(effectType) {
    this.activeEffects.delete(effectType);
  }

  /** Permanent (not duration-based) max-HP shrink — dark Entropy passive. */
  applyVoidDecay(amount) {
    this.maxHealth = Math.max(20, this.maxHealth - amount);
    this.health = Math.min(this.health, this.maxHealth);
  }

  tickEffects(now) {
    for (const [type, data] of this.activeEffects) {
      if (now > data.expiresAt) {
        this.activeEffects.delete(type);
      }
    }
  }

  getSpeedMultiplier() {
    let mult = 1.0;
    if (this.hasEffect('slow')) mult *= 0.6;
    if (this.hasEffect('freeze') || this.hasEffect('petrify')) mult = 0;
    if (this.hasEffect('phase') && this.class === 'dark') mult = 1.2;
    return mult;
  }

  recordDamageTo(targetId) {
    this.lastDamageTime.set(targetId, Date.now());
  }

  hasRecentDamageTo(targetId) {
    const t = this.lastDamageTime.get(targetId);
    if (!t) return false;
    return Date.now() - t < DEATH_NOTE_DAMAGE_WINDOW;
  }

  // -- Wire format helpers (GAME_TICK) ----------------------------------------
  // serialize() below is the full snapshot (ROOM_STATE / PLAYER_JOINED). Every
  // 64Hz tick instead sends serializeHot() plus, only when something changed,
  // the cold-shared fields (coldDelta) for everybody and the owner-only fields
  // (ownerDelta) for the owning client alone. See Room._broadcastTick.

  /** Fields that change (nearly) every tick, sent to every client. */
  serializeHot() {
    const effects = {};
    for (const [k, v] of this.activeEffects) effects[k] = v;
    const now = Date.now();
    const hot = {
      position: { x: r3(this.position.x), y: r3(this.position.y), z: r3(this.position.z) },
      yaw: r4(this.yaw),
      pitch: r4(this.pitch),
      velocity: { x: r3(this.velocity.x), y: r3(this.velocity.y), z: r3(this.velocity.z) },
      health: r2(this.health),
      mana: Math.round(this.mana),
      isAlive: this.isAlive,
      activeSlot: this.activeSlot,
    };
    // Omitted while empty/false; the client treats "absent" as {} / false for
    // these (see expandTickPayload in gameStore.ts).
    for (const _ in effects) { hot.activeEffects = effects; break; }
    if (this.isChoosingBranch) hot.isChoosingBranch = true;
    if (this.defensiveActive && now < this.defensiveExpiry) hot.defensiveActive = true;
    if (this.parryActive && now < this.parryExpiry) hot.parryActive = true;
    return hot;
  }

  /**
   * Remaining cooldowns in whole ms (only spells still cooling down; absent
   * == ready). Remote players only get the active-slot spell's entry, which is
   * all anyone else reads (SniperSightLines); the owner gets everything.
   */
  cooldownsForWire(ownerView) {
    const now = Date.now();
    const out = {};
    if (ownerView) {
      for (const [k, v] of this.cooldowns) {
        const ms = v - now;
        if (ms > 0) out[k] = Math.round(ms);
      }
    } else {
      const spellId = this.equippedSpells[this.activeSlot ?? 0];
      const until = spellId ? this.cooldowns.get(spellId) : undefined;
      if (until !== undefined && until > now) out[spellId] = Math.round(until - now);
    }
    return out;
  }

  /** Identity/loadout fields every client needs, but only when they change (Bot adds its own). */
  _coldSharedKeys() { return COLD_SHARED_KEYS; }

  /** Fields of the cold-shared set that differ from what was last sent, or null. */
  coldDelta() {
    this._coldSent ??= {};
    return diffKeys(this, this._coldSharedKeys(), this._coldSent);
  }

  /** Progression fields only the owning client reads, changed since last sent, or null. */
  ownerDelta() {
    this._ownerSent ??= {};
    return diffKeys(this, COLD_OWNER_KEYS, this._ownerSent);
  }

  /** Forget what was sent so the next tick re-sends all cold fields (on (re)join). */
  resetWireCache() {
    this._coldSent = null;
    this._ownerSent = null;
  }

  serialize() {
    const effects = {};
    for (const [k, v] of this.activeEffects) effects[k] = v;
    const cooldownData = {};
    for (const [k, v] of this.cooldowns) cooldownData[k] = Math.max(0, v - Date.now());

    return {
      id: this.id,
      username: this.username,
      class: this.class,
      team: this.team,
      isAlive: this.isAlive,
      health: this.health,
      maxHealth: this.maxHealth,
      mana: Math.round(this.mana),
      maxMana: this.maxMana,
      position: this.position,
      velocity: { ...this.velocity }, // full snapshots (ROOM_STATE/PLAYER_JOINED) replace rather than merge, so they carry it too
      yaw: this.yaw,
      pitch: this.pitch,
      equippedSpells: this.equippedSpells,
      activeSlot: this.activeSlot,
      isChoosingBranch: this.isChoosingBranch,
      cooldowns: cooldownData,
      activeEffects: effects,
      skillPoints: this.skillPoints,
      level: this.level,
      xp: this.xp,
      divergedBranch: { ...this.divergedBranch },
      unlockedNodes: [...this.unlockedNodes],
      revealedLore: [...this.revealedLore],
      kills: this.kills,
      elo: this.elo,
      ping: this.ping,
      isBot: false,
      defensiveActive: this.defensiveActive && Date.now() < this.defensiveExpiry,
      parryActive: this.parryActive && Date.now() < this.parryExpiry,
      phantomCasts: this.phantomCasts,
    };
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;

/** Wire-comparable copy of a value: Sets become arrays, arrays/objects are copied one level. */
function snapshot(v) {
  if (v instanceof Set) return [...v];
  if (Array.isArray(v)) return [...v];
  if (v && typeof v === 'object') return { ...v };
  return v;
}

function sameValue(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

function sameSet(arr, set) {
  for (let i = 0; i < arr.length; i++) if (!set.has(arr[i])) return false;
  return true;
}

export const COLD_SHARED_KEYS = [
  'id', 'username', 'class', 'team', 'maxHealth', 'maxMana', 'equippedSpells',
  'level', 'kills', 'elo', 'ping', 'isBot', 'phantomCasts',
];
const COLD_OWNER_KEYS = ['skillPoints', 'xp', 'divergedBranch', 'unlockedNodes', 'revealedLore'];

/**
 * Compares `src[key]` for each key against the last-sent snapshot `sent`
 * (updated in place) and returns only the changed fields, or null if none
 * changed. Sets are compared by membership without allocating when unchanged.
 */
function diffKeys(src, keys, sent) {
  let out = null;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = src[k];
    if (v instanceof Set) {
      const prev = sent[k];
      if (prev && prev.length === v.size && sameSet(prev, v)) continue;
      sent[k] = [...v];
      (out ??= {})[k] = sent[k];
    } else if (!(k in sent) || !sameValue(v, sent[k])) {
      sent[k] = snapshot(v);
      (out ??= {})[k] = sent[k];
    }
  }
  return out;
}
