/**
 * The card "recipe" -- a parameterization of everything visually changeable
 * about a spell card, so that looks can be *generated* and *banked* rather
 * than hand-authored one at a time.
 *
 * The design problem this solves: with ~15 spells on screen late game, a
 * tier-1 starter and a tier-9 capstone looked equally loud. Every axis here
 * is therefore scaled by `grade` (0..1, normally derived from spell tier) so
 * that power reads instantly -- a high-grade card gets a more elaborate
 * silhouette, more ornament, live particles and a stronger aura, while a
 * tier-1 card stays deliberately plain.
 *
 * A recipe is plain JSON: generated in bulk by cardRecipeGen.ts, browsed and
 * picked in the Design Lab, stored in cardRecipeBank.json, and rendered by
 * CardArt.tsx. Nothing here imports React -- it's data only.
 */

// ─── Vocabularies ──────────────────────────────────────────────────────────
// Each axis is a small closed set. Generation is combinatorial across them,
// which is what makes "a ton a ton" of distinct-but-coherent cards possible,
// but every individual value is hand-picked to look good so no combination
// lands somewhere ugly.

/** Card silhouette (a clip-path; the actual polygons live in cardFrames.ts). */
export const FRAMES = [
  'plain', 'jagged', 'crystalline', 'torn', 'beveled', 'rough',
  'arch', 'obelisk', 'fang', 'shard', 'coffin', 'tablet', 'spire', 'lotus', 'reliquary',
] as const;

/** Treatment of the outer edge itself. */
export const BORDERS = ['flat', 'double', 'inlaid', 'glowline', 'none'] as const;

/** How the card's interior is filled behind the art. */
export const FILLS = ['gradient', 'radial', 'vignette', 'void', 'frosted', 'ember', 'veil'] as const;

/** Static, seeded overlay art -- the card's "engraving". */
export const TEXTURES = [
  'none', 'diagonals', 'cracks', 'lattice', 'runes', 'scales',
  'filigree', 'starfield', 'flakes', 'strata', 'circuitry', 'thorns',
] as const;

/** Live animated layers. CSS-only (transform/opacity), so they stay off the JS thread. */
export const MOTIONS = [
  'snow', 'embers', 'motes', 'ash', 'sparks', 'rain',
  'orbit', 'pulse', 'sweep', 'shimmer', 'drift', 'crackle',
] as const;

/** Ring treatment around the centre type-glyph. */
export const SIGIL_RINGS = ['none', 'conic', 'dashed', 'double', 'halo', 'orbitals'] as const;

/** Ornament tucked into the card corners. */
export const CORNERS = ['none', 'pips', 'gems', 'runes', 'filigree'] as const;

/**
 * How the spell's own color/glowColor get bent before use. `natural` uses
 * them as-is; the others are why Amaterasu reads the way it does -- a
 * near-black base under a hot saturated glow is far more striking than a
 * mid-tone base, and `obsidian` reproduces that on any palette.
 */
export const PALETTE_MODS = ['natural', 'obsidian', 'bleached', 'inverted', 'duotone', 'ashen'] as const;

export const NAME_CASES = ['normal', 'upper', 'wide'] as const;

export type FrameId = (typeof FRAMES)[number];
export type BorderId = (typeof BORDERS)[number];
export type FillId = (typeof FILLS)[number];
export type TextureId = (typeof TEXTURES)[number];
export type MotionId = (typeof MOTIONS)[number];
export type SigilRingId = (typeof SIGIL_RINGS)[number];
export type CornerId = (typeof CORNERS)[number];
export type PaletteModId = (typeof PALETTE_MODS)[number];
export type NameCaseId = (typeof NAME_CASES)[number];

// ─── Rarity ────────────────────────────────────────────────────────────────

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type RarityId = (typeof RARITIES)[number];

export interface RarityBand {
  id: RarityId;
  label: string;
  /** Colour of the corner gems / rarity pips. */
  gem: string;
  /** Inclusive upper bound on `grade` for this band. */
  maxGrade: number;
  /**
   * Multiplier on the card's footprint in the hotbar. Rarity buys physical
   * space, for two reasons that reinforce each other: a mythic earns a
   * grander name and a more worked silhouette, and both of those need room
   * that a common card doesn't -- long epithets ("of the Patient Earth")
   * wrap to three lines, and the ornate frames eat into the interior at the
   * waist. Scaling with rarity means the card that says the most also has
   * the most room to say it, and the size difference is itself a power tell
   * before you read a single word.
   */
  scale: number;
}

/**
 * Grade -> rarity. Bands are uneven on purpose: most spells should feel
 * ordinary so that the few that aren't actually land.
 */
export const RARITY_BANDS: RarityBand[] = [
  { id: 'common',    label: 'Common',    gem: '#8890a0', maxGrade: 0.14, scale: 1.00 },
  { id: 'uncommon',  label: 'Uncommon',  gem: '#4fd47a', maxGrade: 0.32, scale: 1.05 },
  { id: 'rare',      label: 'Rare',      gem: '#4fa9ff', maxGrade: 0.54, scale: 1.11 },
  { id: 'epic',      label: 'Epic',      gem: '#c264ff', maxGrade: 0.74, scale: 1.18 },
  { id: 'legendary', label: 'Legendary', gem: '#ffcf4d', maxGrade: 0.92, scale: 1.27 },
  { id: 'mythic',    label: 'Mythic',    gem: '#ff5c7a', maxGrade: 1.01, scale: 1.38 },
];

export function rarityForGrade(grade: number): RarityBand {
  return RARITY_BANDS.find((b) => grade <= b.maxGrade) ?? RARITY_BANDS[RARITY_BANDS.length - 1];
}

/** Footprint multiplier for a recipe: its rarity band, nudged by how much the frame's own geometry steals from the interior. */
export function cardScale(recipe: CardRecipe, frameInset: number): number {
  return rarityForGrade(recipe.grade).scale * (1 + frameInset * 0.5);
}

// ─── The recipe ────────────────────────────────────────────────────────────

export interface CardRecipe {
  /** Stable slug, unique within the bank. */
  id: string;
  /** Evocative generated name, derived from the params (see cardRecipeGen). */
  name: string;
  /** 0..1 power reading. Drives ornament density, motion count and aura. */
  grade: number;

  frame: FrameId;
  border: BorderId;
  /** Outer edge thickness in px (1..4). */
  borderWidth: number;

  fill: FillId;
  paletteMod: PaletteModId;

  texture: TextureId;
  /** 0..1 -- how many marks the texture lays down. */
  textureDensity: number;

  /** 0..3 live layers. Empty on low-grade cards, which is the point. */
  motion: MotionId[];
  /** 0..1 -- particle count and speed multiplier. */
  motionRate: number;

  sigilRing: SigilRingId;
  /** 0..1 -- strength of the radial bloom behind the type glyph. */
  sigilHalo: number;

  corner: CornerId;
  nameCase: NameCaseId;

  /** 0..1 -- outer drop-shadow bloom around the whole card. */
  aura: number;
  /** Whether the aura breathes rather than sitting static. */
  auraPulse: boolean;

  /** Seeds the deterministic scatter of texture marks and particles. */
  seed: number;
}

/**
 * A recipe plus where it came from. The bank stores these so a pick can be
 * traced back (and re-rolled) later.
 */
export interface BankEntry {
  recipe: CardRecipe;
  /** Free-text note from the Design Lab. */
  note?: string;
  /** Spell ids this recipe is currently assigned to. */
  assigned?: string[];
}

export interface CardRecipeBank {
  /** Recipes kept for future use, keyed by recipe id. */
  bank: Record<string, BankEntry>;
  /** spellId -> recipe id in `bank`. What SpellCard actually reads. */
  assignments: Record<string, string>;
}

/** A grade-0 recipe with everything switched off -- the base every generator starts from. */
export const NULL_RECIPE: CardRecipe = {
  id: 'null', name: 'Unadorned', grade: 0,
  frame: 'plain', border: 'flat', borderWidth: 2,
  fill: 'gradient', paletteMod: 'natural',
  texture: 'none', textureDensity: 0,
  motion: [], motionRate: 0,
  sigilRing: 'conic', sigilHalo: 0.4,
  corner: 'none', nameCase: 'normal',
  aura: 0, auraPulse: false,
  seed: 0,
};
