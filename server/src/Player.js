import { PLAYER_MAX_HEALTH, BASE_MOVE_SPEED, PLAYER_HEIGHT, RESPAWN_DELAY, DEATH_NOTE_DAMAGE_WINDOW } from 'shared/constants';
import { DEFAULT_EQUIPPED, MOBILITY_SPELL } from 'shared/spells';

export class Player {
  constructor({ id, ws, username }) {
    this.id = id;
    this.ws = ws;
    this.username = username ?? `Wizard_${id.slice(0, 4)}`;

    // State
    this.class = null;
    this.isAlive = false;
    this.health = PLAYER_MAX_HEALTH;
    this.maxHealth = PLAYER_MAX_HEALTH;
    this.skillPoints = 0;
    this.xp = 0;
    this.level = 1;
    this.divergedBranch = {}; // branchGroup -> chosen branch id
    this.unlockedNodes = new Set();
    this.oncePerLifeUsed = new Set(); // e.g. 'death_note', 'phoenix'

    // Position / physics (server-side authoritative)
    this.position = { x: 0, y: PLAYER_HEIGHT, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.isGrounded = false;

    // Spells
    this.equippedSpells = [null, null, null, null]; // 4 active slots
    this.mobilitySpell = null;
    this.cooldowns = new Map(); // spellId → expiry timestamp

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

    // Parry state
    this.parryActive = false;
    this.parryExpiry = 0;
    this.lastParryTime = 0;

    // Passive counters
    this.keenEdgeCounter = 0; // sword: every 5th hit deals double
    this.geologicStacks = 0; // earth: defense stacks while casting
    this.geologicResetTimer = null;
    this.kindlingStacks = 0; // fire: damage buff after Ember Flick
    this.bedrock = false; // earth: standing still buff

    // Phase slip state (dark)
    this.isPhasing = false;
    this.phaseExpiry = 0;
  }

  selectClass(className) {
    this.class = className;
    this.equippedSpells = [...DEFAULT_EQUIPPED[className]];
    this.mobilitySpell = MOBILITY_SPELL[className];
    this.divergedBranch = {};
    // Auto-unlock default spells so they can be re-equipped after unequipping
    for (const spellId of this.equippedSpells) {
      if (spellId) this.unlockedNodes.add(spellId);
    }
  }

  spawn(position) {
    this.isAlive = true;
    this.health = this.maxHealth;
    this.position = { ...position };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.activeEffects.clear();
    this.oncePerLifeUsed.clear();
    this.parryActive = false;
    this.isPhasing = false;
    this.phantomCasts = 0;
    this.keenEdgeCounter = 0;
    this.geologicStacks = 0;
    this.kindlingStacks = 0;
    this.bedrock = false;
    // clear per-life cooldowns
    this.cooldowns.delete('death_note');
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

  applyEffect(effectType, duration, stacks = 1) {
    const existing = this.activeEffects.get(effectType);
    const newExpiry = Date.now() + duration;
    const newStacks = existing ? Math.min(existing.stacks + stacks, 3) : stacks;
    this.activeEffects.set(effectType, { expiresAt: newExpiry, stacks: newStacks });
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

  serialize() {
    const effects = {};
    for (const [k, v] of this.activeEffects) effects[k] = v;
    const cooldownData = {};
    for (const [k, v] of this.cooldowns) cooldownData[k] = Math.max(0, v - Date.now());

    return {
      id: this.id,
      username: this.username,
      class: this.class,
      isAlive: this.isAlive,
      health: this.health,
      maxHealth: this.maxHealth,
      position: this.position,
      yaw: this.yaw,
      pitch: this.pitch,
      equippedSpells: this.equippedSpells,
      cooldowns: cooldownData,
      activeEffects: effects,
      skillPoints: this.skillPoints,
      level: this.level,
      xp: this.xp,
      divergedBranch: { ...this.divergedBranch },
      unlockedNodes: [...this.unlockedNodes],
      kills: this.kills,
      ping: this.ping,
    };
  }
}
