/**
 * XP/level/rank progression and wizard-hat scaling. Shared so the server can
 * award XP + gate the hat-contact buff, and the client can derive the same
 * rank name / hat geometry without the server needing to send strings.
 */

import { PLAYER_HEIGHT } from './constants.js';

export const XP_PER_KILL = 50;

export function xpForNextLevel(level) {
  return 60 + level * 40;
}

/** Level, remaining xp into that level, xp needed for the next one, and the fraction between. */
export function xpProgress(xp) {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpForNextLevel(level)) {
    remaining -= xpForNextLevel(level);
    level++;
  }
  const needed = xpForNextLevel(level);
  return { level, intoLevel: remaining, needed, fraction: needed > 0 ? remaining / needed : 0 };
}

export function levelFromXp(xp) {
  return xpProgress(xp).level;
}

export const RANKS = [
  { name: 'Novice', minLevel: 1 },
  { name: 'Apprentice', minLevel: 3 },
  { name: 'Adept', minLevel: 6 },
  { name: 'Magus', minLevel: 10 },
  { name: 'Archmage', minLevel: 15 },
  { name: 'Sovereign Wizard', minLevel: 21 },
];

export function rankForLevel(level) {
  let best = RANKS[0];
  for (const r of RANKS) {
    if (level >= r.minLevel) best = r;
  }
  return best;
}

// ── Wizard hat ───────────────────────────────────────────────────────────
// Geometry constants mirror the client's cone mesh (base radius/height before
// scale, and the local-space Y where it sits atop the head sphere) so the
// server can compute the same hat volume for hit-detection without touching
// three.js.

const HAT_CONE_HEIGHT = 0.5;
const HAT_CONE_RADIUS = 0.28;
const HAT_BASE_LOCAL_Y = 1.95; // local Y (above feet) where the cone base sits, atop the head sphere
const HAT_MAX_SCALE = 2.2;

export function hatScaleForLevel(level) {
  return Math.min(HAT_MAX_SCALE, 1 + Math.max(0, level - 1) * 0.06);
}

/** World-space Y of the hat's volumetric center, given the target's eye-level Y. */
export function hatCenterY(targetEyeY, level) {
  const scale = hatScaleForLevel(level);
  const feetY = targetEyeY - PLAYER_HEIGHT;
  return feetY + HAT_BASE_LOCAL_Y + (HAT_CONE_HEIGHT * scale) / 2;
}

/** Approximate hit-test radius for the hat volume at a given level. */
export function hatRadius(level) {
  return HAT_CONE_RADIUS * hatScaleForLevel(level) + 0.12; // small forgiveness margin
}

// ── Hat contact buff ─────────────────────────────────────────────────────
// Bonking a bigger hat is a better prize. Tier maps to the stacks field on
// the existing activeEffects {expiresAt, stacks} shape (see Player.applyEffect).

export function hatBuffTierForLevel(level) {
  if (level >= 15) return 3;
  if (level >= 6) return 2;
  return 1;
}

export const HAT_BUFF_DAMAGE_MULT = { 1: 0.05, 2: 0.12, 3: 0.20 };
export const HAT_BUFF_DURATION_MS = { 1: 6000, 2: 8000, 3: 10000 };

// ── Mana ─────────────────────────────────────────────────────────────────
// Capacity and regen both grow with level and vary by class. Ranged/status
// casters (ice, dark) lean on bigger pools; sword barely uses mana at all
// (its kit is mostly cheap tier-1/2 spells) so it gets the smallest pool but
// the fastest regen relative to its size -- it was never meant to be
// mana-gated the way the other four are.
const MANA_BASE = { fire: 90, ice: 120, dark: 130, sword: 60, earth: 100 };
const MANA_REGEN_BASE = { fire: 11, ice: 13, dark: 12, sword: 10, earth: 10 }; // per second
const MANA_PER_LEVEL = 7;
const MANA_REGEN_PER_LEVEL = 0.5;

export function maxManaFor(wizardClass, level) {
  const base = MANA_BASE[wizardClass] ?? 100;
  return Math.round(base + MANA_PER_LEVEL * Math.max(0, level - 1));
}

export function manaRegenFor(wizardClass, level) {
  const base = MANA_REGEN_BASE[wizardClass] ?? 11;
  return base + MANA_REGEN_PER_LEVEL * Math.max(0, level - 1);
}
