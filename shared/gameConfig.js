// Balance constants that may be tweaked without touching spell definitions

export const STATUS_EFFECTS = {
  burn: { tickDamage: 8, tickInterval: 500, maxStacks: 3 },
  slow: { speedMultiplier: 0.6, duration: 2000 },
  freeze: { duration: 1500, breakOnDamage: true },
  stun: { duration: 800 },
  airborne: { damageMultiplier: 1.25 },
  phase: { untargetable: true, duration: 2000 },
  petrify: { duration: 2500, breakOnDamage: false },
  void_decay: { maxHpReduction: 10 }, // dark Entropy passive
};

export const DOMAIN_CONFIGS = {
  inferno_domain: {
    duration: 4000,
    telegraph: 800,
    cooldown: 60000,
    effect: 'projectile_acceleration',
    accelerationFactor: 2.2,
  },
  absolute_zero: {
    duration: 3000,
    telegraph: 1000,
    cooldown: 75000,
    effect: 'near_stillness',
    speedMultiplier: 0.08,
  },
  event_horizon: {
    duration: 4000,
    telegraph: 1200,
    cooldown: 65000,
    effect: 'gravitational_pull',
    pullForce: 12,
  },
  the_last_word: {
    duration: 3000,
    telegraph: 200, // minimal — by design
    cooldown: 70000,
    effect: 'time_slow',
    otherSpeedMultiplier: 0.15,
  },
  terra_domain: {
    duration: 5000,
    telegraph: 1500,
    cooldown: 80000,
    effect: 'stone_spires',
    ownerSpeedMultiplier: 1.0,
    otherSpeedMultiplier: 0.8,
    spireCount: 12,
  },
};

export const PROJECTILE_GRAVITY = {
  none: 0,
  slight: -3,
  normal: -9,
  heavy: -18,
};
