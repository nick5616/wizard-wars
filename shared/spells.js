/**
 * Canonical spell definitions. Shared by server (authoritative) and client (prediction/UI).
 * All damage/cooldown values are final unless a passive modifies them at runtime.
 */

// spell.type values:
// projectile | beam | hitscan | aoe | domain | direct | passive | mobility

const def = (d) => ({ serverAuthoritative: true, interruptible: false, windupMs: 0, statusEffect: null, statusDuration: 0, selfCost: null, requiresTarget: false, radius: 0, duration: null, speed: null, ...d });

// ─── FIRE ──────────────────────────────────────────────────────────────────

export const FIRE_SPELLS = {
  ember_flick: def({
    id: 'ember_flick', name: 'Ember Flick', school: 'fire', tier: 1, class: 'fire',
    type: 'projectile', damage: 22, cooldown: 0.4, speed: 32, radius: 0.3,
    color: '#ff6b2b', glowColor: '#ff4500',
  }),
  fireball: def({
    id: 'fireball', name: 'Fireball', school: 'fire', tier: 2, class: 'fire',
    type: 'projectile', damage: 85, cooldown: 2.2, speed: 18, radius: 2.5,
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
    type: 'aoe', damage: 20, cooldown: 1.0, radius: 1.5, duration: 5.0,
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
    type: 'hitscan', damage: 240, cooldown: 12.0,
    color: '#ffffa0', glowColor: '#ffffff',
  }),
  magma_dash: def({
    id: 'magma_dash', name: 'Magma Dash', school: 'fire', tier: 1, class: 'fire',
    type: 'mobility', damage: 15, cooldown: 5.0, speed: 25, duration: 0.25,
    color: '#ff4500', glowColor: '#ff6b2b',
  }),
  spark_shot: def({
    id: 'spark_shot', name: 'Spark Shot', school: 'fire', tier: 2, class: 'fire',
    type: 'projectile', damage: 11, cooldown: 0.12, speed: 48, radius: 0.18,
    color: '#ffaa00', glowColor: '#ff6600',
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
    type: 'aoe', damage: 30, cooldown: 5.0, radius: 5.0,
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
    type: 'hitscan', damage: 220, cooldown: 14.0,
    statusEffect: 'freeze', statusDuration: 0, // instant shatter on frozen
    color: '#ffffff', glowColor: '#a0d8ff',
  }),
  glacier_step: def({
    id: 'glacier_step', name: 'Glacier Step', school: 'ice', tier: 1, class: 'ice',
    type: 'mobility', damage: 0, cooldown: 6.0, duration: 0, teleportDistance: 8,
    statusEffect: 'slow', statusDuration: 2000, leaveFrost: true,
    color: '#a0d8ff', glowColor: '#c8f0ff',
  }),
  frost_needle: def({
    id: 'frost_needle', name: 'Frost Needle', school: 'ice', tier: 2, class: 'ice',
    type: 'projectile', damage: 9, cooldown: 0.15, speed: 44, radius: 0.12,
    statusEffect: 'slow', statusDuration: 250,
    color: '#88ddff', glowColor: '#aaeeff',
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
    type: 'hitscan', damage: 180, cooldown: 10.0,
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
    type: 'mobility', damage: 0, cooldown: 7.0, duration: 2.0,
    statusEffect: 'phase', statusDuration: 2000,
    color: '#6600cc', glowColor: '#aa00ff',
  }),
  void_tap: def({
    id: 'void_tap', name: 'Void Tap', school: 'dark', tier: 2, class: 'dark',
    type: 'aoe', damage: 18, cooldown: 0.1, radius: 2.8,
    color: '#4400aa', glowColor: '#7700ee',
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
    type: 'hitscan', damage: 260, cooldown: 11.0,
    wallPiercing: false, destroysBarriers: true, bypassesParry: true,
    color: '#ffffff', glowColor: '#c8c8ff',
  }),
  lunge: def({
    id: 'lunge', name: 'Lunge', school: 'sword', tier: 1, class: 'sword',
    type: 'mobility', damage: 30, cooldown: 5.0, speed: 28, duration: 0.2,
    color: '#c8c8c8', glowColor: '#ffffff',
  }),
  quick_cut: def({
    id: 'quick_cut', name: 'Quick Cut', school: 'sword', tier: 2, class: 'sword',
    type: 'aoe', damage: 13, cooldown: 0.09, radius: 2.2,
    color: '#e8e8e8', glowColor: '#ffffff',
  }),
};

// ─── EARTH ─────────────────────────────────────────────────────────────────

export const EARTH_SPELLS = {
  pebble_shot: def({
    id: 'pebble_shot', name: 'Pebble Shot', school: 'earth', tier: 1, class: 'earth',
    type: 'projectile', damage: 28, cooldown: 0.6, speed: 25, radius: 0.35,
    color: '#8B6914', glowColor: '#a08030',
  }),
  stone_spire: def({
    id: 'stone_spire', name: 'Stone Spire', school: 'earth', tier: 2, class: 'earth',
    type: 'aoe', damage: 75, cooldown: 3.0, radius: 1.5, windupMs: 400,
    color: '#8B6914', glowColor: '#6B5010',
  }),
  rock_wall: def({
    id: 'rock_wall', name: 'Rock Wall', school: 'earth', tier: 3, class: 'earth',
    type: 'aoe', damage: 0, cooldown: 10.0, duration: 15.0,
    isBarrier: true, barrierHealth: 240, requiresBreaks: 2,
    color: '#6B5010', glowColor: '#8B6914',
  }),
  avalanche: def({
    id: 'avalanche', name: 'Avalanche', school: 'earth', tier: 4, class: 'earth',
    type: 'projectile', damage: 140, cooldown: 6.0, speed: 10, radius: 3.5,
    statusEffect: 'stun', statusDuration: 600,
    color: '#8B6914', glowColor: '#6B5010',
  }),
  petrify: def({
    id: 'petrify', name: 'Petrify', school: 'earth', tier: 5, class: 'earth',
    type: 'direct', damage: 0, cooldown: 12.0, requiresTarget: true, windupMs: 800,
    statusEffect: 'petrify', statusDuration: 2500,
    color: '#8B6914', glowColor: '#a08030',
  }),
  fissure: def({
    id: 'fissure', name: 'Fissure', school: 'earth', tier: 6, class: 'earth',
    type: 'aoe', damage: 60, cooldown: 7.0, radius: 1.5, length: 12,
    statusEffect: 'airborne', statusDuration: 1200,
    color: '#6B5010', glowColor: '#8B6914',
  }),
  terra_domain: def({
    id: 'terra_domain', name: 'Terra Domain', school: 'earth', tier: 7, class: 'earth',
    type: 'domain', damage: 45, cooldown: 80.0, duration: 5.0,
    color: '#8B6914', glowColor: '#6B5010',
  }),
  the_monolith: def({
    id: 'the_monolith', name: 'The Monolith', school: 'earth', tier: 8, class: 'earth',
    type: 'hitscan', damage: 280, cooldown: 16.0,
    windupMs: 1000, // visible for a full second
    statusEffect: 'slow', statusDuration: 3000,
    color: '#8B6914', glowColor: '#6B5010',
  }),
  stone_launch: def({
    id: 'stone_launch', name: 'Stone Launch', school: 'earth', tier: 1, class: 'earth',
    type: 'mobility', damage: 20, cooldown: 6.0, duration: 0.5,
    effect: 'launch_upward', launchForce: 20,
    color: '#8B6914', glowColor: '#a08030',
  }),
  dirt_clod: def({
    id: 'dirt_clod', name: 'Dirt Clod', school: 'earth', tier: 2, class: 'earth',
    type: 'projectile', damage: 9, cooldown: 0.18, speed: 30, radius: 0.22,
    spreadCount: 3, spreadAngle: 18,
    color: '#aa8822', glowColor: '#cc9933',
  }),
};

// ─── All spells flat map ────────────────────────────────────────────────────

export const ALL_SPELLS = {
  ...FIRE_SPELLS,
  ...ICE_SPELLS,
  ...DARK_SPELLS,
  ...SWORD_SPELLS,
  ...EARTH_SPELLS,
};

export const getSpell = (id) => ALL_SPELLS[id] ?? null;

// Default starting spells per class (slot index → spell id)
export const DEFAULT_EQUIPPED = {
  fire:  ['ember_flick', 'fireball', null, null],
  ice:   ['frost_bite', 'glacial_spike', null, null],
  dark:  ['void_touch', 'soul_drain', null, null],
  sword: ['iron_edge', 'bladestorm', null, null],
  earth: ['pebble_shot', 'stone_spire', null, null],
};

// Mobility spells per class (triggered by Shift, not in regular slots)
export const MOBILITY_SPELL = {
  fire:  'magma_dash',
  ice:   'glacier_step',
  dark:  'phase_slip',
  sword: 'lunge',
  earth: 'stone_launch',
};
