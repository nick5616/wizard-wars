/**
 * Canonical spell definitions. Shared by server (authoritative) and client (prediction/UI).
 * All damage/cooldown values are final unless a passive modifies them at runtime.
 */

// spell.type values:
// projectile | arc | beam | hitscan | aoe | domain | direct | passive | mobility | melee | rune | defensive
//
// 'arc' is a gravity-affected projectile (lobbed) -- see SpellSystem._castProjectile
// and tickProjectiles. Give it a `gravity: 'slight'|'normal'|'heavy'` field
// (default 'normal', see shared/gameConfig.js PROJECTILE_GRAVITY) and treat
// `speed` as its initial launch speed; the launch angle is auto-picked from
// the caster's forward/backward movement, not aimed with the camera pitch.

// Default mana cost by tier -- keeps ~90 spells from needing a hand-tuned
// number each. Index = spell tier, clamped to the top band for anything
// higher (the tier-11 earth ultimate, etc). Individual spells can still
// override by passing their own manaCost.
const MANA_BY_TIER = [0, 10, 16, 22, 28, 34, 40, 50, 58, 65, 70, 75];
const manaForTier = (tier) => MANA_BY_TIER[Math.min(tier ?? 1, MANA_BY_TIER.length - 1)] ?? 20;

const def = (d) => ({
  serverAuthoritative: true, interruptible: false, windupMs: 0, statusEffect: null, statusDuration: 0,
  selfCost: null, requiresTarget: false, radius: 0, duration: null, speed: null,
  // Mobility and defensive spells live outside the 4-slot economy already
  // (triggered by Shift / Q, never equipped) -- same treatment as basic
  // attack/melee (tier 0, so they fall out to 0 mana naturally below), they
  // don't draw from mana either.
  manaCost: d.type === 'mobility' || d.type === 'defensive' ? 0 : manaForTier(d.tier),
  ...d,
});

// ─── FIRE ──────────────────────────────────────────────────────────────────

export const FIRE_SPELLS = {
  ember_flick: def({
    id: 'ember_flick', name: 'Ember Flick', school: 'fire', tier: 1, class: 'fire',
    type: 'projectile', damage: 22, cooldown: 0.4, speed: 32, radius: 0.3,
    color: '#ff6b2b', glowColor: '#ff4500',
  }),
  fireball: def({
    id: 'fireball', name: 'Fireball', school: 'fire', tier: 2, class: 'fire',
    type: 'arc', gravity: 'normal', damage: 85, cooldown: 2.2, speed: 24, radius: 2.5,
    statusEffect: 'burn', statusDuration: 1500,
    color: '#ff4500', glowColor: '#ff8c00',
  }),
  cauterize: def({
    id: 'cauterize', name: 'Cauterize', school: 'fire', tier: 3, class: 'fire',
    type: 'beam', damage: 12, cooldown: 3.5, duration: 2.0,
    statusEffect: 'slow', statusDuration: 2000,
    color: '#ff6b2b', glowColor: '#ff4500',
  }),
  lightning_strike: def({
    id: 'lightning_strike', name: 'Lightning Strike', school: 'fire', tier: 4, class: 'fire',
    type: 'aoe', damage: 70, cooldown: 4.0, radius: 2.0, windupMs: 600,
    statusEffect: 'stun', statusDuration: 800,
    color: '#ffe066', glowColor: '#ffffff',
  }),
  immolate: def({
    id: 'immolate', name: 'Immolate', school: 'fire', tier: 4, class: 'fire',
    type: 'aoe', damage: 20, cooldown: 1.0, radius: 1.5, duration: 5.0, selfCast: true,
    statusEffect: 'burn', statusDuration: 1000,
    color: '#ff4500', glowColor: '#ff8c00',
  }),
  chain_lightning: def({
    id: 'chain_lightning', name: 'Chain Lightning', school: 'fire', tier: 5, class: 'fire',
    type: 'hitscan', damage: 55, cooldown: 5.0, bounces: 3,
    statusEffect: 'stun', statusDuration: 400,
    color: '#ffe066', glowColor: '#ffffff',
  }),
  eruption: def({
    id: 'eruption', name: 'Eruption', school: 'fire', tier: 5, class: 'fire',
    type: 'aoe', damage: 110, cooldown: 6.0, radius: 3.5, windupMs: 500,
    statusEffect: 'burn', statusDuration: 2000,
    color: '#ff4500', glowColor: '#ff2200',
  }),
  amaterasu: def({
    id: 'amaterasu', name: 'Amaterasu', school: 'fire', tier: 6, class: 'fire',
    type: 'direct', damage: 8, cooldown: 8.0, requiresTarget: true, duration: 30.0,
    statusEffect: 'burn', statusDuration: 30000, selfCost: 0,
    color: '#1a0000', glowColor: '#ff0000',
    isEternal: true,
  }),
  inferno_domain: def({
    id: 'inferno_domain', name: 'Inferno Domain', school: 'fire', tier: 7, class: 'fire',
    type: 'domain', damage: 0, cooldown: 60.0, duration: 4.0,
    color: '#ff4500', glowColor: '#ff8c00',
  }),
  god_ray: def({
    id: 'god_ray', name: 'God Ray', school: 'fire', tier: 8, class: 'fire',
    // sniperSight: a faint aim line is visible to everyone (not just you)
    // while this is your selected spell -- lets a target downrange feel it
    // coming, like a laser sight, before you've even fired.
    type: 'hitscan', damage: 240, cooldown: 12.0, sniperSight: true,
    color: '#ffffa0', glowColor: '#ffffff',
  }),
  magma_dash: def({
    id: 'magma_dash', name: 'Magma Dash', school: 'fire', tier: 1, class: 'fire',
    type: 'mobility', damage: 8, cooldown: 1.5, speed: 25, duration: 0.25,
    color: '#ff4500', glowColor: '#ff6b2b',
  }),
  spark_shot: def({
    id: 'spark_shot', name: 'Spark Shot', school: 'fire', tier: 2, class: 'fire',
    type: 'projectile', damage: 11, cooldown: 0.12, speed: 48, radius: 0.18,
    color: '#ffaa00', glowColor: '#ff6600',
  }),
  // ── Runes: placed on the ground, arm briefly, then detonate on the first
  // enemy to walk into them (see SpellSystem._castRune / tickRunes). ─────────
  rune_ember: def({
    id: 'rune_ember', name: 'Ember Rune', school: 'fire', tier: 2, class: 'fire',
    type: 'rune', damage: 45, cooldown: 7.0, radius: 2.0, armMs: 400, duration: 18000,
    statusEffect: 'burn', statusDuration: 1500,
    color: '#ff6b2b', glowColor: '#ff4500',
  }),
  rune_magma: def({
    id: 'rune_magma', name: 'Magma Rune', school: 'fire', tier: 9, class: 'fire',
    type: 'rune', damage: 140, cooldown: 15.0, radius: 3.0, armMs: 500, duration: 20000,
    statusEffect: 'burn', statusDuration: 2500,
    color: '#ff4500', glowColor: '#ff2200',
  }),
};

// ─── ICE ───────────────────────────────────────────────────────────────────

export const ICE_SPELLS = {
  frost_bite: def({
    id: 'frost_bite', name: 'Frost Bite', school: 'ice', tier: 1, class: 'ice',
    type: 'aoe', damage: 18, cooldown: 0.8, radius: 3.0, duration: 0.2,
    statusEffect: 'slow', statusDuration: 800,
    color: '#a0d8ff', glowColor: '#c8f0ff',
  }),
  glacial_spike: def({
    id: 'glacial_spike', name: 'Glacial Spike', school: 'ice', tier: 2, class: 'ice',
    type: 'projectile', damage: 65, cooldown: 1.5, speed: 28, radius: 0.4,
    statusEffect: 'slow', statusDuration: 600,
    piercing: true,
    color: '#a0d8ff', glowColor: '#00c8ff',
  }),
  ice_wall: def({
    id: 'ice_wall', name: 'Ice Wall', school: 'ice', tier: 3, class: 'ice',
    type: 'aoe', damage: 0, cooldown: 8.0, duration: 12.0, radius: 0,
    isBarrier: true, barrierHealth: 120,
    color: '#c8f0ff', glowColor: '#a0d8ff',
  }),
  frost_nova: def({
    id: 'frost_nova', name: 'Frost Nova', school: 'ice', tier: 4, class: 'ice',
    // selfCast: it's a "ground pulse" centered on the caster -- without this
    // it landed 12 units out along your aim like every other aimed aoe,
    // which for a nova almost never actually caught anyone.
    type: 'aoe', damage: 30, cooldown: 5.0, radius: 5.0, selfCast: true,
    statusEffect: 'freeze', statusDuration: 1500,
    color: '#a0d8ff', glowColor: '#ffffff',
  }),
  shatter: def({
    id: 'shatter', name: 'Shatter', school: 'ice', tier: 4, class: 'ice',
    type: 'direct', damage: 200, cooldown: 1.0, requiresTarget: true,
    requiresStatusEffect: 'freeze',
    color: '#ffffff', glowColor: '#a0d8ff',
  }),
  blizzard: def({
    id: 'blizzard', name: 'Blizzard', school: 'ice', tier: 5, class: 'ice',
    type: 'aoe', damage: 8, cooldown: 12.0, radius: 8.0, duration: 5.0,
    statusEffect: 'slow', statusDuration: 500,
    color: '#a0d8ff', glowColor: '#c8f0ff',
  }),
  cryo_lance: def({
    id: 'cryo_lance', name: 'Cryo Lance', school: 'ice', tier: 5, class: 'ice',
    type: 'projectile', damage: 195, cooldown: 7.0, speed: 14, radius: 1.2,
    windupMs: 800, piercing: true, wallPiercing: true,
    statusEffect: 'freeze', statusDuration: 2000,
    color: '#00c8ff', glowColor: '#a0d8ff',
  }),
  absolute_zero: def({
    id: 'absolute_zero', name: 'Absolute Zero', school: 'ice', tier: 7, class: 'ice',
    type: 'domain', damage: 5, cooldown: 75.0, duration: 3.0,
    color: '#a0d8ff', glowColor: '#ffffff',
  }),
  divine_judgement: def({
    id: 'divine_judgement', name: 'Divine Judgement', school: 'ice', tier: 8, class: 'ice',
    type: 'hitscan', damage: 220, cooldown: 14.0, sniperSight: true,
    statusEffect: 'freeze', statusDuration: 0, // instant shatter on frozen
    color: '#ffffff', glowColor: '#a0d8ff',
  }),
  glacier_step: def({
    id: 'glacier_step', name: 'Glacier Step', school: 'ice', tier: 1, class: 'ice',
    type: 'mobility', damage: 0, cooldown: 1.8, duration: 0, teleportDistance: 8,
    statusEffect: 'slow', statusDuration: 2000, leaveFrost: true,
    color: '#a0d8ff', glowColor: '#c8f0ff',
  }),
  frost_needle: def({
    id: 'frost_needle', name: 'Frost Needle', school: 'ice', tier: 2, class: 'ice',
    type: 'projectile', damage: 9, cooldown: 0.15, speed: 44, radius: 0.12,
    statusEffect: 'slow', statusDuration: 250,
    color: '#88ddff', glowColor: '#aaeeff',
  }),
  rune_rime: def({
    id: 'rune_rime', name: 'Rime Rune', school: 'ice', tier: 2, class: 'ice',
    type: 'rune', damage: 35, cooldown: 7.0, radius: 2.0, armMs: 400, duration: 18000,
    statusEffect: 'slow', statusDuration: 1500,
    color: '#a0d8ff', glowColor: '#c8f0ff',
  }),
  rune_glacier: def({
    id: 'rune_glacier', name: 'Glacier Rune', school: 'ice', tier: 9, class: 'ice',
    type: 'rune', damage: 130, cooldown: 15.0, radius: 3.0, armMs: 500, duration: 20000,
    statusEffect: 'freeze', statusDuration: 2000,
    color: '#00c8ff', glowColor: '#ffffff',
  }),
  glacial_lob: def({
    id: 'glacial_lob', name: 'Glacial Lob', school: 'ice', tier: 2, class: 'ice',
    // Arced ice boulder -- shatters into a frost-nova slow field wherever it lands
    // (see SpellSystem._explodeAtPosition, triggers on any floor impact with radius > 0.8).
    type: 'arc', gravity: 'normal', damage: 55, cooldown: 3.0, speed: 20, radius: 1.4,
    statusEffect: 'slow', statusDuration: 1800,
    color: '#a0d8ff', glowColor: '#00c8ff',
  }),
};

// ─── DARK ──────────────────────────────────────────────────────────────────

export const DARK_SPELLS = {
  void_touch: def({
    id: 'void_touch', name: 'Void Touch', school: 'dark', tier: 1, class: 'dark',
    type: 'aoe', damage: 30, cooldown: 0.9, radius: 3.5,
    color: '#6600cc', glowColor: '#aa00ff',
  }),
  soul_drain: def({
    id: 'soul_drain', name: 'Soul Drain', school: 'dark', tier: 2, class: 'dark',
    type: 'beam', damage: 18, cooldown: 4.0, duration: 2.0,
    lifesteal: 0.6, interruptible: true,
    color: '#6600cc', glowColor: '#cc00ff',
  }),
  obliterate: def({
    id: 'obliterate', name: 'Obliterate', school: 'dark', tier: 3, class: 'dark',
    type: 'projectile', damage: 105, cooldown: 3.0, speed: 22, radius: 0.8,
    color: '#220044', glowColor: '#6600cc',
  }),
  blood_lance: def({
    id: 'blood_lance', name: 'Blood Lance', school: 'dark', tier: 4, class: 'dark',
    type: 'projectile', damage: 75, cooldown: 1.8, speed: 26, radius: 0.5,
    lifesteal: 0.4,
    color: '#cc0000', glowColor: '#ff0044',
    branch: 'vampiric',
  }),
  void_bloom: def({
    id: 'void_bloom', name: 'Void Bloom', school: 'dark', tier: 4, class: 'dark',
    type: 'projectile', damage: 60, cooldown: 2.5, speed: 12, radius: 3.0,
    onImpact: 'void_tendrils',
    color: '#4400aa', glowColor: '#6600cc',
    branch: 'void',
  }),
  blood_nova: def({
    id: 'blood_nova', name: 'Blood Nova', school: 'dark', tier: 5, class: 'dark',
    type: 'aoe', damage: 80, cooldown: 8.0, radius: 6.0,
    lifesteal: 1.0, selfCast: true,
    color: '#cc0000', glowColor: '#ff0044',
    branch: 'vampiric',
  }),
  singularity: def({
    id: 'singularity', name: 'Singularity', school: 'dark', tier: 5, class: 'dark',
    type: 'aoe', damage: 0, cooldown: 10.0, radius: 8.0, duration: 3.0,
    effect: 'gravity_well',
    color: '#220044', glowColor: '#6600cc',
    branch: 'void',
  }),
  event_horizon: def({
    id: 'event_horizon', name: 'Event Horizon', school: 'dark', tier: 7, class: 'dark',
    type: 'domain', damage: 8, cooldown: 65.0, duration: 4.0,
    color: '#220044', glowColor: '#6600cc',
  }),
  null_gaze: def({
    id: 'null_gaze', name: 'Null Gaze', school: 'dark', tier: 8, class: 'dark',
    type: 'hitscan', damage: 180, cooldown: 10.0, sniperSight: true,
    wallPiercing: true, leavesTrail: true, trailDuration: 3000,
    color: '#220044', glowColor: '#4400aa',
  }),
  death_note: def({
    id: 'death_note', name: 'Death Note', school: 'dark', tier: 9, class: 'dark',
    type: 'direct', damage: 99999, cooldown: 99999.0, requiresTarget: true,
    windupMs: 3500, interruptible: true, oncePerLife: true,
    requiresRecentDamage: true, interruptedCooldown: 30.0,
    color: '#000000', glowColor: '#cc0000',
  }),
  phase_slip: def({
    id: 'phase_slip', name: 'Phase Slip', school: 'dark', tier: 1, class: 'dark',
    type: 'mobility', damage: 0, cooldown: 2.2, duration: 2.0,
    statusEffect: 'phase', statusDuration: 2000,
    color: '#6600cc', glowColor: '#aa00ff',
  }),
  void_tap: def({
    id: 'void_tap', name: 'Void Tap', school: 'dark', tier: 2, class: 'dark',
    type: 'aoe', damage: 18, cooldown: 0.1, radius: 2.8,
    color: '#4400aa', glowColor: '#7700ee',
  }),
  rune_hex: def({
    id: 'rune_hex', name: 'Hex Rune', school: 'dark', tier: 2, class: 'dark',
    type: 'rune', damage: 40, cooldown: 7.0, radius: 2.0, armMs: 400, duration: 18000,
    lifesteal: 0.5,
    color: '#6600cc', glowColor: '#aa00ff',
  }),
  rune_soul: def({
    id: 'rune_soul', name: 'Soul Rune', school: 'dark', tier: 10, class: 'dark',
    type: 'rune', damage: 150, cooldown: 15.0, radius: 3.0, armMs: 500, duration: 20000,
    lifesteal: 0.8,
    color: '#220044', glowColor: '#cc00ff',
  }),
  hex_bomb: def({
    id: 'hex_bomb', name: 'Hex Bomb', school: 'dark', tier: 2, class: 'dark',
    // Lobbed void orb -- onImpact reuses Void Bloom's pull-together tendril zone.
    type: 'arc', gravity: 'normal', damage: 50, cooldown: 3.0, speed: 18, radius: 2.2,
    onImpact: 'void_tendrils',
    color: '#4400aa', glowColor: '#6600cc',
  }),
};

// ─── SWORD ─────────────────────────────────────────────────────────────────

export const SWORD_SPELLS = {
  iron_edge: def({
    id: 'iron_edge', name: 'Iron Edge', school: 'sword', tier: 1, class: 'sword',
    type: 'aoe', damage: 45, cooldown: 0.5, radius: 2.5,
    color: '#c8c8c8', glowColor: '#ffffff',
  }),
  bladestorm: def({
    id: 'bladestorm', name: 'Bladestorm', school: 'sword', tier: 2, class: 'sword',
    type: 'projectile', damage: 35, cooldown: 1.5, speed: 24, radius: 0.6,
    spreadCount: 5, spreadAngle: 30,
    color: '#c8c8c8', glowColor: '#e0e0e0',
  }),
  phantom_blade: def({
    id: 'phantom_blade', name: 'Phantom Blade', school: 'sword', tier: 3, class: 'sword',
    type: 'direct', damage: 0, cooldown: 6.0, duration: 8.0,
    effect: 'mirror_next_two_casts', requiresTarget: false,
    color: '#8888cc', glowColor: '#aaaaff',
  }),
  parry: def({
    id: 'parry', name: 'Parry', school: 'sword', tier: 4, class: 'sword',
    type: 'direct', damage: 0, cooldown: 4.0, duration: 0.6,
    effect: 'reflect_next_projectile',
    color: '#c8c8c8', glowColor: '#ffffff',
  }),
  blade_rain: def({
    id: 'blade_rain', name: 'Blade Rain', school: 'sword', tier: 4, class: 'sword',
    type: 'aoe', damage: 15, cooldown: 8.0, radius: 6.0, duration: 4.0,
    color: '#c8c8c8', glowColor: '#e0e0e0',
  }),
  riposte: def({
    id: 'riposte', name: 'Riposte', school: 'sword', tier: 5, class: 'sword',
    type: 'mobility', damage: 95, cooldown: 0, duration: 0.3,
    requiresParry: true, teleportToTarget: true,
    color: '#c8c8c8', glowColor: '#ffffff',
  }),
  siege_blade: def({
    id: 'siege_blade', name: 'Siege Blade', school: 'sword', tier: 5, class: 'sword',
    type: 'projectile', damage: 180, cooldown: 9.0, speed: 10, radius: 2.0,
    destroysBarriers: true, windupMs: 600,
    color: '#c8c8c8', glowColor: '#ffffff',
  }),
  sovereign_cut: def({
    id: 'sovereign_cut', name: 'Sovereign Cut', school: 'sword', tier: 6, class: 'sword',
    type: 'aoe', damage: 320, cooldown: 20.0, radius: 3.0, windupMs: 1200,
    color: '#ffffff', glowColor: '#c8c8c8',
  }),
  the_last_word: def({
    id: 'the_last_word', name: 'The Last Word', school: 'sword', tier: 7, class: 'sword',
    type: 'domain', damage: 0, cooldown: 70.0, duration: 3.0,
    color: '#c8c8c8', glowColor: '#ffffff',
  }),
  gods_edge: def({
    id: 'gods_edge', name: "God's Edge", school: 'sword', tier: 8, class: 'sword',
    type: 'hitscan', damage: 260, cooldown: 11.0, sniperSight: true,
    wallPiercing: false, destroysBarriers: true, bypassesParry: true,
    color: '#ffffff', glowColor: '#c8c8ff',
  }),
  lunge: def({
    id: 'lunge', name: 'Lunge', school: 'sword', tier: 1, class: 'sword',
    type: 'mobility', damage: 15, cooldown: 1.5, speed: 28, duration: 0.2,
    color: '#c8c8c8', glowColor: '#ffffff',
  }),
  quick_cut: def({
    id: 'quick_cut', name: 'Quick Cut', school: 'sword', tier: 2, class: 'sword',
    type: 'aoe', damage: 13, cooldown: 0.09, radius: 2.2,
    color: '#e8e8e8', glowColor: '#ffffff',
  }),
  rune_snare: def({
    id: 'rune_snare', name: 'Snare Rune', school: 'sword', tier: 2, class: 'sword',
    type: 'rune', damage: 40, cooldown: 7.0, radius: 1.8, armMs: 400, duration: 18000,
    statusEffect: 'stun', statusDuration: 600,
    color: '#c8c8c8', glowColor: '#ffffff',
  }),
  rune_executioner: def({
    id: 'rune_executioner', name: "Executioner's Rune", school: 'sword', tier: 9, class: 'sword',
    type: 'rune', damage: 160, cooldown: 15.0, radius: 2.5, armMs: 500, duration: 20000,
    statusEffect: 'stun', statusDuration: 1200,
    color: '#ffffff', glowColor: '#c8c8ff',
  }),
  thrown_blade: def({
    id: 'thrown_blade', name: 'Thrown Blade', school: 'sword', tier: 2, class: 'sword',
    // Flat, hard-thrown spinning blade -- lighter gravity than Fireball, a
    // quicker/flatter arc rather than a high lob. Direct-hit only, no AoE.
    type: 'arc', gravity: 'slight', damage: 70, cooldown: 2.0, speed: 26, radius: 0.5,
    color: '#c8c8c8', glowColor: '#ffffff',
  }),
};

// ─── DRUID ─────────────────────────────────────────────────────────────────
// Nature/control/sustain half of the former "earth" class.

export const DRUID_SPELLS = {
  thorn_dart: def({
    id: 'thorn_dart', name: 'Thorn Dart', school: 'druid', tier: 1, class: 'druid',
    type: 'projectile', damage: 28, cooldown: 0.6, speed: 25, radius: 0.35,
    color: '#5a9e3d', glowColor: '#8fd15a',
  }),
  seed_burst: def({
    id: 'seed_burst', name: 'Seed Burst', school: 'druid', tier: 2, class: 'druid',
    type: 'projectile', damage: 9, cooldown: 0.18, speed: 30, radius: 0.22,
    spreadCount: 3, spreadAngle: 18,
    color: '#7cb342', glowColor: '#a5d66b',
  }),
  spore_pod: def({
    id: 'spore_pod', name: 'Spore Pod', school: 'druid', tier: 2.5, class: 'druid',
    // Lobbed seed pod -- blooms into a brief entangling root patch on impact.
    type: 'arc', gravity: 'normal', damage: 45, cooldown: 3.2, speed: 19, radius: 1.6,
    statusEffect: 'slow', statusDuration: 2200,
    color: '#5a9e3d', glowColor: '#8fd15a',
  }),
  bramble_burst: def({
    id: 'bramble_burst', name: 'Bramble Burst', school: 'druid', tier: 3, class: 'druid',
    type: 'aoe', damage: 75, cooldown: 3.0, radius: 1.5, windupMs: 400,
    color: '#3d6e2a', glowColor: '#5a9e3d',
  }),
  avalanche: def({
    id: 'avalanche', name: 'Avalanche', school: 'druid', tier: 4, class: 'druid',
    type: 'projectile', damage: 140, cooldown: 6.0, speed: 10, radius: 3.5,
    statusEffect: 'stun', statusDuration: 600,
    color: '#8B6914', glowColor: '#6B5010',
  }),
  root_snare: def({
    id: 'root_snare', name: 'Root Snare', school: 'druid', tier: 5, class: 'druid',
    type: 'direct', damage: 0, cooldown: 12.0, requiresTarget: true, windupMs: 800,
    // Same "encased, fully immobilized" mechanic as the old Petrify -- here it's roots, not stone.
    statusEffect: 'petrify', statusDuration: 2500,
    color: '#3d6e2a', glowColor: '#8fd15a',
  }),
  fissure: def({
    id: 'fissure', name: 'Fissure', school: 'druid', tier: 6, class: 'druid',
    type: 'aoe', damage: 60, cooldown: 7.0, radius: 1.5, length: 12,
    statusEffect: 'airborne', statusDuration: 1200,
    color: '#6B5010', glowColor: '#8B6914',
  }),
  wildwood_domain: def({
    id: 'wildwood_domain', name: 'Wildwood Domain', school: 'druid', tier: 7, class: 'druid',
    type: 'domain', damage: 45, cooldown: 80.0, duration: 5.0,
    color: '#3d6e2a', glowColor: '#5a9e3d',
  }),
  verdant_lance: def({
    id: 'verdant_lance', name: 'Verdant Lance', school: 'druid', tier: 8, class: 'druid',
    type: 'hitscan', damage: 280, cooldown: 16.0, sniperSight: true,
    windupMs: 1000, // visible for a full second
    statusEffect: 'slow', statusDuration: 3000,
    color: '#3d6e2a', glowColor: '#5a9e3d',
  }),
  root_launch: def({
    id: 'root_launch', name: 'Root Launch', school: 'druid', tier: 1, class: 'druid',
    type: 'mobility', damage: 10, cooldown: 1.8, duration: 0.5,
    effect: 'launch_upward', launchForce: 20,
    color: '#5a9e3d', glowColor: '#8fd15a',
  }),
  rune_root: def({
    id: 'rune_root', name: 'Root Rune', school: 'druid', tier: 2, class: 'druid',
    type: 'rune', damage: 45, cooldown: 7.0, radius: 2.2, armMs: 400, duration: 18000,
    statusEffect: 'stun', statusDuration: 500,
    color: '#5a9e3d', glowColor: '#8fd15a',
  }),
  rune_seismic: def({
    id: 'rune_seismic', name: 'Seismic Rune', school: 'druid', tier: 11, class: 'druid',
    type: 'rune', damage: 150, cooldown: 15.0, radius: 3.5, armMs: 500, duration: 20000,
    statusEffect: 'stun', statusDuration: 1000,
    color: '#3d6e2a', glowColor: '#5a9e3d',
  }),
};

// ─── CRYSTALMANCER ───────────────────────────────────────────────────────────
// Crystal/burst/reflect half of the former "earth" class.

export const CRYSTALMANCER_SPELLS = {
  crystal_shard: def({
    id: 'crystal_shard', name: 'Crystal Shard', school: 'crystalmancer', tier: 1, class: 'crystalmancer',
    type: 'projectile', damage: 28, cooldown: 0.6, speed: 25, radius: 0.35,
    color: '#8fd4ff', glowColor: '#c8f0ff',
  }),
  shard_burst: def({
    id: 'shard_burst', name: 'Shard Burst', school: 'crystalmancer', tier: 2, class: 'crystalmancer',
    type: 'projectile', damage: 9, cooldown: 0.18, speed: 30, radius: 0.22,
    spreadCount: 3, spreadAngle: 18,
    color: '#a8dfff', glowColor: '#d8f4ff',
  }),
  geode_bomb: def({
    id: 'geode_bomb', name: 'Geode Bomb', school: 'crystalmancer', tier: 2.5, class: 'crystalmancer',
    // Lobbed crystal -- falls fast (heavy gravity) and shatters into a shrapnel burst.
    type: 'arc', gravity: 'heavy', damage: 65, cooldown: 3.5, speed: 17, radius: 1.8,
    color: '#8fd4ff', glowColor: '#c8f0ff',
  }),
  crystal_spire: def({
    id: 'crystal_spire', name: 'Crystal Spire', school: 'crystalmancer', tier: 3, class: 'crystalmancer',
    type: 'aoe', damage: 75, cooldown: 3.0, radius: 1.5, windupMs: 400,
    color: '#6fb8e0', glowColor: '#8fd4ff',
  }),
  crystal_wall: def({
    id: 'crystal_wall', name: 'Crystal Wall', school: 'crystalmancer', tier: 4, class: 'crystalmancer',
    type: 'aoe', damage: 0, cooldown: 10.0, duration: 15.0,
    isBarrier: true, barrierHealth: 240, requiresBreaks: 2,
    color: '#6fb8e0', glowColor: '#8fd4ff',
  }),
  petrify: def({
    id: 'petrify', name: 'Petrify', school: 'crystalmancer', tier: 5, class: 'crystalmancer',
    type: 'direct', damage: 0, cooldown: 12.0, requiresTarget: true, windupMs: 800,
    statusEffect: 'petrify', statusDuration: 2500,
    color: '#8fd4ff', glowColor: '#c8f0ff',
  }),
  shard_fracture: def({
    id: 'shard_fracture', name: 'Shard Fracture', school: 'crystalmancer', tier: 6, class: 'crystalmancer',
    type: 'aoe', damage: 60, cooldown: 7.0, radius: 1.5, length: 12,
    statusEffect: 'airborne', statusDuration: 1200,
    color: '#6fb8e0', glowColor: '#8fd4ff',
  }),
  prism_field: def({
    id: 'prism_field', name: 'Prism Field', school: 'crystalmancer', tier: 7, class: 'crystalmancer',
    type: 'domain', damage: 45, cooldown: 80.0, duration: 5.0,
    color: '#8fd4ff', glowColor: '#6fb8e0',
  }),
  the_monolith: def({
    id: 'the_monolith', name: 'The Monolith', school: 'crystalmancer', tier: 8, class: 'crystalmancer',
    type: 'hitscan', damage: 280, cooldown: 16.0, sniperSight: true,
    windupMs: 1000, // visible for a full second
    statusEffect: 'slow', statusDuration: 3000,
    color: '#8fd4ff', glowColor: '#6fb8e0',
  }),
  rune_shard: def({
    id: 'rune_shard', name: 'Shard Rune', school: 'crystalmancer', tier: 2, class: 'crystalmancer',
    type: 'rune', damage: 45, cooldown: 7.0, radius: 2.2, armMs: 400, duration: 18000,
    statusEffect: 'stun', statusDuration: 500,
    color: '#8fd4ff', glowColor: '#c8f0ff',
  }),
  crystal_launch: def({
    id: 'crystal_launch', name: 'Crystal Launch', school: 'crystalmancer', tier: 1, class: 'crystalmancer',
    type: 'mobility', damage: 10, cooldown: 1.8, duration: 0.5,
    effect: 'launch_upward', launchForce: 20,
    color: '#8fd4ff', glowColor: '#c8f0ff',
  }),
  rune_prism: def({
    id: 'rune_prism', name: 'Prism Rune', school: 'crystalmancer', tier: 11, class: 'crystalmancer',
    type: 'rune', damage: 150, cooldown: 15.0, radius: 3.5, armMs: 500, duration: 20000,
    statusEffect: 'stun', statusDuration: 1000,
    color: '#6fb8e0', glowColor: '#8fd4ff',
  }),
};

// ─── Basic attack & melee (always available, no unlock, outside the 4 equip
// slots -- same "outside the slot system" treatment as MOBILITY_SPELL below).
// Weak hitscan poke with a fast cooldown: the payoff for tracking an enemy
// instead of committing to a slow, heavy spell. Melee is the up-close fallback
// -- mostly a plain punch, since none of these classes fight barehanded for a
// living.
// ─────────────────────────────────────────────────────────────────────────

export const BASIC_ATTACKS = {
  fire_spark_poke:    def({ id: 'fire_spark_poke',    name: 'Spark Poke',    school: 'fire',  tier: 0, class: 'fire',  type: 'hitscan', damage: 10, cooldown: 0.2, color: '#ffcc66', glowColor: '#ff8800' }),
  ice_frost_flick:    def({ id: 'ice_frost_flick',    name: 'Frost Flick',   school: 'ice',   tier: 0, class: 'ice',   type: 'hitscan', damage: 10, cooldown: 0.2, color: '#cceeff', glowColor: '#88ccff' }),
  dark_void_lash:     def({ id: 'dark_void_lash',     name: 'Void Lash',     school: 'dark',  tier: 0, class: 'dark',  type: 'hitscan', damage: 10, cooldown: 0.2, color: '#aa66ff', glowColor: '#6600cc' }),
  sword_dagger_flick: def({ id: 'sword_dagger_flick', name: 'Dagger Flick',  school: 'sword', tier: 0, class: 'sword', type: 'hitscan', damage: 10, cooldown: 0.2, color: '#dddddd', glowColor: '#ffffff' }),
  druid_thorn_sting:  def({ id: 'druid_thorn_sting',  name: 'Thorn Sting',   school: 'druid', tier: 0, class: 'druid', type: 'hitscan', damage: 10, cooldown: 0.2, color: '#8fd15a', glowColor: '#5a9e3d' }),
  crystal_shard_chip: def({ id: 'crystal_shard_chip', name: 'Shard Chip',    school: 'crystalmancer', tier: 0, class: 'crystalmancer', type: 'hitscan', damage: 10, cooldown: 0.2, color: '#c8f0ff', glowColor: '#8fd4ff' }),
};

export const MELEE_ATTACKS = {
  fire_punch:          def({ id: 'fire_punch',          name: 'Punch',           school: 'fire',  tier: 0, class: 'fire',  type: 'melee', damage: 18, cooldown: 0.6, radius: 2.2, color: '#ff6600', glowColor: '#ff8800' }),
  ice_punch:            def({ id: 'ice_punch',            name: 'Punch',           school: 'ice',   tier: 0, class: 'ice',   type: 'melee', damage: 18, cooldown: 0.6, radius: 2.2, color: '#a0d8ff', glowColor: '#ffffff' }),
  dark_punch:           def({ id: 'dark_punch',           name: 'Punch',           school: 'dark',  tier: 0, class: 'dark',  type: 'melee', damage: 18, cooldown: 0.6, radius: 2.2, color: '#6600cc', glowColor: '#aa00ff' }),
  sword_pommel_strike:  def({ id: 'sword_pommel_strike',  name: 'Pommel Strike',   school: 'sword', tier: 0, class: 'sword', type: 'melee', damage: 18, cooldown: 0.6, radius: 2.2, color: '#c8c8c8', glowColor: '#ffffff' }),
  bramble_strike:       def({ id: 'bramble_strike',       name: 'Bramble Strike',  school: 'druid', tier: 0, class: 'druid', type: 'melee', damage: 18, cooldown: 0.6, radius: 2.2, color: '#5a9e3d', glowColor: '#8fd15a' }),
  crystal_fist:         def({ id: 'crystal_fist',         name: 'Crystal Fist',    school: 'crystalmancer', tier: 0, class: 'crystalmancer', type: 'melee', damage: 18, cooldown: 0.6, radius: 2.2, color: '#8fd4ff', glowColor: '#c8f0ff' }),
};

export const BASIC_ATTACK = {
  fire: 'fire_spark_poke', ice: 'ice_frost_flick', dark: 'dark_void_lash', sword: 'sword_dagger_flick',
  druid: 'druid_thorn_sting', crystalmancer: 'crystal_shard_chip',
};

export const MELEE_ATTACK = {
  fire: 'fire_punch', ice: 'ice_punch', dark: 'dark_punch', sword: 'sword_pommel_strike',
  druid: 'bramble_strike', crystalmancer: 'crystal_fist',
};

// ─── Defensive spells (triggered by Q, not in regular slots) ───────────────
// One fixed, always-available defensive spell per class -- same "outside the
// slot system" treatment as mobility, just bound to a different key. Every
// class gets exactly one, no choice, no unlock required. Three mechanical
// flavors: `damageReduction` (a % taken-damage cut for `duration`),
// `absorbAmount` (a flat HP shield pool that soaks hits until it runs out or
// `duration` expires), and `fullCounter` (negates the next hit entirely and
// reflects its damage back at the attacker -- see Room.applyDamage).
export const DEFENSIVE_SPELLS = {
  flame_ward: def({
    id: 'flame_ward', name: 'Flame Ward', school: 'fire', tier: 1, class: 'fire',
    type: 'defensive', damage: 0, cooldown: 14.0, duration: 4.0, selfCast: true,
    damageReduction: 0.4,
    color: '#ff6b2b', glowColor: '#ffb347',
  }),
  ice_barrier: def({
    id: 'ice_barrier', name: 'Ice Barrier', school: 'ice', tier: 1, class: 'ice',
    type: 'defensive', damage: 0, cooldown: 16.0, duration: 7.0, selfCast: true,
    absorbAmount: 90,
    color: '#a0d8ff', glowColor: '#d8f4ff',
  }),
  // Dark: a hard parry against everything, not just projectiles (unlike
  // Sword's primary-tree Parry, which only reflects projectiles) -- negates
  // the next hit outright and throws its damage back at whoever landed it.
  // Short window, long cooldown: a trump card, not a habit.
  umbral_counter: def({
    id: 'umbral_counter', name: 'Umbral Counter', school: 'dark', tier: 1, class: 'dark',
    type: 'defensive', damage: 0, cooldown: 20.0, duration: 1.2, selfCast: true,
    fullCounter: true,
    color: '#6600cc', glowColor: '#ff44ff',
  }),
  // Sword: a physical guard, distinct from the primary-tree Parry (which
  // only reflects the next projectile) -- flat mitigation against anything,
  // shorter window, shorter cooldown.
  blade_guard: def({
    id: 'blade_guard', name: 'Blade Guard', school: 'sword', tier: 1, class: 'sword',
    type: 'defensive', damage: 0, cooldown: 12.0, duration: 2.5, selfCast: true,
    damageReduction: 0.55,
    color: '#c8c8c8', glowColor: '#eeeeee',
  }),
  crystal_shield: def({
    id: 'crystal_shield', name: 'Crystal Shield', school: 'crystalmancer', tier: 1, class: 'crystalmancer',
    type: 'defensive', damage: 0, cooldown: 18.0, duration: 8.0, selfCast: true,
    absorbAmount: 110,
    color: '#8fd4ff', glowColor: '#ff8fd4',
  }),
  bark_ward: def({
    id: 'bark_ward', name: 'Bark Ward', school: 'druid', tier: 1, class: 'druid',
    type: 'defensive', damage: 0, cooldown: 18.0, duration: 8.0, selfCast: true,
    absorbAmount: 110,
    color: '#5a9e3d', glowColor: '#8fd15a',
  }),
};

export const DEFENSIVE_SPELL = {
  fire:  'flame_ward',
  ice:   'ice_barrier',
  dark:  'umbral_counter',
  sword: 'blade_guard',
  druid: 'bark_ward',
  crystalmancer: 'crystal_shield',
};

// ─── All spells flat map ────────────────────────────────────────────────────

export const ALL_SPELLS = {
  ...FIRE_SPELLS,
  ...ICE_SPELLS,
  ...DARK_SPELLS,
  ...SWORD_SPELLS,
  ...DRUID_SPELLS,
  ...CRYSTALMANCER_SPELLS,
  ...BASIC_ATTACKS,
  ...MELEE_ATTACKS,
  ...DEFENSIVE_SPELLS,
};

export const getSpell = (id) => ALL_SPELLS[id] ?? null;

/** Equip slots are keyed off the top-row digits 1-9 then 0, so 10 is the hard cap. */
export const MAX_SPELL_SLOTS = 10;

/** True for spells that belong in a regular equip slot (excludes passives and the Shift mobility / Q defensive spells). */
export const isEquippableSpell = (spell) => spell.type !== 'passive' && spell.type !== 'mobility' && spell.type !== 'defensive';

// Default starting spells per class (slot index → spell id). Padded to
// MAX_SPELL_SLOTS -- remaining slots open up as the player unlocks more spells.
export const DEFAULT_EQUIPPED = {
  fire:  ['ember_flick', 'fireball', ...Array(MAX_SPELL_SLOTS - 2).fill(null)],
  ice:   ['frost_bite', 'glacial_spike', ...Array(MAX_SPELL_SLOTS - 2).fill(null)],
  dark:  ['void_touch', 'soul_drain', ...Array(MAX_SPELL_SLOTS - 2).fill(null)],
  sword: ['iron_edge', 'bladestorm', ...Array(MAX_SPELL_SLOTS - 2).fill(null)],
  druid: ['thorn_dart', 'bramble_burst', ...Array(MAX_SPELL_SLOTS - 2).fill(null)],
  crystalmancer: ['crystal_shard', 'crystal_spire', ...Array(MAX_SPELL_SLOTS - 2).fill(null)],
};

// Mobility spells per class (triggered by Shift, not in regular slots)
export const MOBILITY_SPELL = {
  fire:  'magma_dash',
  ice:   'glacier_step',
  dark:  'phase_slip',
  sword: 'lunge',
  druid: 'root_launch',
  crystalmancer: 'crystal_launch',
};
