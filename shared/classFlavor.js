/**
 * Cosmetic identity for a class: a base elemental symbol, and a richer
 * symbol/title once a player has committed to one side of their class's
 * skill-tree fork (see shared/skillTrees.js's branchGroup/branch fields).
 * Shared so the server can stamp a symbol onto kill-feed events and the
 * client can render the same thing everywhere else (HUD badge, etc.)
 * without duplicating the mapping.
 */

export const CLASS_SYMBOL = { fire: '🔥', ice: '❄️', dark: '🌑', sword: '⚔️', druid: '🌿', crystalmancer: '💎' };
export const CLASS_LABEL = { fire: 'Fire', ice: 'Ice', dark: 'Dark', sword: 'Sword', druid: 'Druid', crystalmancer: 'Crystalmancer' };

// wizardClass -> branchGroup id, matching shared/skillTrees.js's one fork per class.
export const CLASS_FORK_GROUP = {
  fire: 'fire_fork', ice: 'ice_fork', dark: 'dark_fork', sword: 'sword_fork', druid: 'druid_fork', crystalmancer: 'crystal_fork',
};

// branchGroup -> branch id -> flavor once a player has diverged.
export const BRANCH_FLAVOR = {
  fire_fork: {
    lightning: { symbol: '⚡', title: 'Lightning Mage' },
    immolate: { symbol: '🔥', title: 'Pyromancer' },
  },
  ice_fork: {
    nova: { symbol: '❆', title: 'Frostcaller' },
    shatter: { symbol: '💎', title: 'Shatterer' },
  },
  dark_fork: {
    vampiric: { symbol: '🩸', title: 'Blood Warlock' },
    void: { symbol: '🕳️', title: 'Void Warlock' },
  },
  sword_fork: {
    parry: { symbol: '🛡️', title: 'Duelist' },
    blade_rain: { symbol: '🗡️', title: 'Warlord' },
  },
  druid_fork: {
    overgrowth: { symbol: '🌳', title: 'Warden' },
    feral: { symbol: '🐺', title: 'Feral Druid' },
  },
  crystal_fork: {
    prismatic: { symbol: '🔷', title: 'Prism Adept' },
    shattering: { symbol: '💥', title: 'Crystal Breaker' },
  },
};

/** { symbol, title } for a class + its diverged-branch state (or the plain elemental default pre-fork). */
export function classFlavor(wizardClass, divergedBranch) {
  if (!wizardClass) return { symbol: '', title: '' };
  const groupKey = CLASS_FORK_GROUP[wizardClass];
  const branch = divergedBranch?.[groupKey];
  const flavor = branch && BRANCH_FLAVOR[groupKey]?.[branch];
  if (flavor) return flavor;
  return { symbol: CLASS_SYMBOL[wizardClass] ?? '', title: CLASS_LABEL[wizardClass] ?? '' };
}

export function classSymbol(wizardClass, divergedBranch) {
  return classFlavor(wizardClass, divergedBranch).symbol;
}
