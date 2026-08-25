/**
 * Generates card recipes: coherent, named, seeded points in the parameter
 * space defined by data/cardRecipe.ts.
 *
 * Two ideas keep the output usable rather than noise:
 *
 * 1. THEMES. Picking every axis independently produces cards like "frosted
 *    fill + ember particles + thorn engraving", which reads as a mistake. So
 *    a theme is chosen first -- an affinity bundle of textures, motions,
 *    frames and palettes that belong together -- and axes are sampled from
 *    inside it. That's what makes a glacial card actually look *cold*:
 *    frosted fill, flake engraving, drifting snow, bleached palette, all
 *    agreeing with each other.
 *
 * 2. GRADE. Every axis is then biased by a 0..1 power scalar, so elaboration
 *    tracks strength. Low grade means a plain silhouette, no engraving, no
 *    motion, no aura. High grade unlocks the worked frames, live particles
 *    and a breathing bloom. This is the whole point of the system: a hotbar
 *    of 15 spells should sort itself visually without reading a word.
 *
 * Names are derived from the params that were actually chosen, so a recipe's
 * name describes it -- "Rimeglass Reliquary" really is a frosted lotus/
 * reliquary frame, "Cinderwrought Fang" really is an ember-motion fang.
 */

import { seededRandom, seedFromString } from './cardSeed';
import {
  type CardRecipe, type FrameId, type MotionId, type TextureId,
  type PaletteModId, type FillId, type BorderId, type SigilRingId,
  type CornerId, type NameCaseId,
  rarityForGrade,
} from '../data/cardRecipe';
import { FRAME_ELABORATION } from '../data/cardFrames';

// ─── Themes ────────────────────────────────────────────────────────────────

export const THEME_IDS = ['glacial', 'infernal', 'void', 'martial', 'telluric', 'arcane', 'verdant', 'astral', 'prismatic'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

interface Theme {
  id: ThemeId;
  label: string;
  /** Ordered plain -> elaborate; the generator indexes by grade. */
  frames: FrameId[];
  textures: TextureId[];
  motions: MotionId[];
  fills: FillId[];
  palettes: PaletteModId[];
  /** Name fragments. `adj` prefixes, `noun` heads, `epithet` for high grade. */
  adj: string[];
  noun: string[];
  epithet: string[];
}

const THEMES: Record<ThemeId, Theme> = {
  glacial: {
    id: 'glacial', label: 'Glacial',
    frames: ['plain', 'crystalline', 'tablet', 'coffin', 'shard', 'lotus', 'reliquary'],
    textures: ['none', 'flakes', 'lattice', 'cracks', 'filigree'],
    motions: ['snow', 'shimmer', 'motes', 'drift', 'pulse'],
    fills: ['frosted', 'radial', 'gradient', 'veil'],
    palettes: ['bleached', 'natural', 'inverted'],
    adj: ['Rime', 'Hoar', 'Glacier', 'Frost', 'Winter', 'Permafrost', 'Snowbound', 'Rimeglass', 'Icebound', 'Cryo', 'Whiteout', 'Silent'],
    noun: ['Facet', 'Shard', 'Lattice', 'Cairn', 'Reliquary', 'Pane', 'Drift', 'Floe', 'Prism', 'Sepulchre'],
    epithet: ['the Long Winter', 'Still Water', 'the Deep Freeze', 'Nine Winters', 'the White Silence'],
  },
  infernal: {
    id: 'infernal', label: 'Infernal',
    frames: ['plain', 'beveled', 'jagged', 'fang', 'shard', 'spire', 'reliquary'],
    textures: ['none', 'diagonals', 'cracks', 'scales', 'strata', 'thorns'],
    motions: ['embers', 'sparks', 'crackle', 'shimmer', 'pulse'],
    fills: ['ember', 'vignette', 'gradient', 'void'],
    palettes: ['natural', 'obsidian', 'ashen', 'duotone'],
    adj: ['Cinder', 'Ember', 'Ash', 'Pyre', 'Scorch', 'Blackfire', 'Cinderwrought', 'Emberclad', 'Slag', 'Kiln', 'Molten', 'Sunblind'],
    noun: ['Fang', 'Brand', 'Crucible', 'Forge', 'Pyre', 'Sigil', 'Maw', 'Ingot', 'Censer', 'Spire'],
    epithet: ['the Black Sun', 'Endless Burning', 'the Last Kiln', 'Seven Fires', 'the Unquenched'],
  },
  void: {
    id: 'void', label: 'Void',
    frames: ['plain', 'torn', 'coffin', 'obelisk', 'shard', 'arch', 'reliquary'],
    textures: ['none', 'starfield', 'runes', 'cracks', 'filigree', 'thorns'],
    motions: ['motes', 'drift', 'pulse', 'ash', 'shimmer'],
    fills: ['void', 'veil', 'vignette', 'radial'],
    palettes: ['obsidian', 'duotone', 'inverted', 'natural'],
    adj: ['Null', 'Umbral', 'Hollow', 'Abyssal', 'Starless', 'Unmade', 'Gravebound', 'Nether', 'Whisper', 'Eclipse', 'Moth', 'Waning'],
    noun: ['Veil', 'Aperture', 'Sepulchre', 'Threshold', 'Hymn', 'Reliquary', 'Wound', 'Gate', 'Chorus', 'Cipher'],
    epithet: ['the Long Dark', 'No Return', 'the Quiet Below', 'Nothing At All', 'the Hollow Choir'],
  },
  martial: {
    id: 'martial', label: 'Martial',
    frames: ['plain', 'beveled', 'tablet', 'obelisk', 'coffin', 'spire', 'reliquary'],
    textures: ['none', 'diagonals', 'lattice', 'circuitry', 'filigree'],
    motions: ['sweep', 'shimmer', 'sparks', 'pulse', 'orbit'],
    fills: ['gradient', 'vignette', 'radial', 'veil'],
    palettes: ['natural', 'ashen', 'bleached', 'inverted'],
    adj: ['Keen', 'Tempered', 'Honed', 'Oath', 'Duelist', 'Steelbound', 'Bladeworn', 'Vigil', 'Iron', 'Parry', 'Riposte', 'Sworn'],
    noun: ['Edge', 'Guard', 'Oath', 'Bastion', 'Kata', 'Standard', 'Aegis', 'Lattice', 'Salute', 'Vigil'],
    epithet: ['the Drawn Blade', 'One Cut', 'the Last Guard', 'Ten Thousand Forms', 'the Unbroken Line'],
  },
  telluric: {
    id: 'telluric', label: 'Telluric',
    frames: ['plain', 'rough', 'tablet', 'obelisk', 'coffin', 'arch', 'reliquary'],
    textures: ['none', 'strata', 'scales', 'cracks', 'thorns', 'lattice'],
    motions: ['ash', 'drift', 'pulse', 'motes', 'crackle'],
    fills: ['gradient', 'vignette', 'radial', 'frosted'],
    palettes: ['ashen', 'natural', 'obsidian', 'duotone'],
    adj: ['Bedrock', 'Loam', 'Tectonic', 'Basalt', 'Moss', 'Deeproot', 'Stonebound', 'Cairn', 'Sediment', 'Quarry', 'Granite', 'Elder'],
    noun: ['Cairn', 'Strata', 'Menhir', 'Root', 'Bulwark', 'Seam', 'Monolith', 'Tablet', 'Hollow', 'Vein'],
    epithet: ['the Deep Root', 'Older Stone', 'the Long Settling', 'Three Mountains', 'the Patient Earth'],
  },
  arcane: {
    id: 'arcane', label: 'Arcane',
    frames: ['plain', 'crystalline', 'tablet', 'arch', 'obelisk', 'spire', 'reliquary'],
    textures: ['none', 'runes', 'filigree', 'circuitry', 'lattice', 'starfield'],
    motions: ['orbit', 'pulse', 'shimmer', 'motes', 'sweep'],
    fills: ['radial', 'veil', 'gradient', 'void'],
    palettes: ['natural', 'inverted', 'duotone', 'obsidian'],
    adj: ['Ordinal', 'Cipher', 'Runebound', 'Axiom', 'Sigilwright', 'Theorem', 'Gilded', 'Prime', 'Woven', 'Archon', 'Sanctum', 'Lucid'],
    noun: ['Sigil', 'Codex', 'Axiom', 'Circle', 'Glyph', 'Reliquary', 'Theorem', 'Lexicon', 'Orrery', 'Rite'],
    epithet: ['the First Circle', 'Written Law', 'the Ninth Proof', 'Every Name', 'the Closed Book'],
  },
  verdant: {
    id: 'verdant', label: 'Verdant',
    frames: ['plain', 'rough', 'crystalline', 'lotus', 'arch', 'spire', 'reliquary'],
    textures: ['none', 'thorns', 'scales', 'filigree', 'lattice'],
    motions: ['drift', 'motes', 'snow', 'shimmer', 'pulse'],
    fills: ['gradient', 'radial', 'frosted', 'veil'],
    palettes: ['natural', 'bleached', 'duotone', 'ashen'],
    adj: ['Bramble', 'Thornwood', 'Wilding', 'Seedborn', 'Blightless', 'Petal', 'Grove', 'Sapwood', 'Overgrown', 'Feral', 'Bloom', 'Green'],
    noun: ['Bloom', 'Thorn', 'Grove', 'Bower', 'Seed', 'Canopy', 'Bramble', 'Garden', 'Wreath', 'Vine'],
    epithet: ['the Green Year', 'Slow Growth', 'the Waking Grove', 'Every Spring', 'the Root and Branch'],
  },
  astral: {
    id: 'astral', label: 'Astral',
    frames: ['plain', 'crystalline', 'coffin', 'arch', 'lotus', 'spire', 'reliquary'],
    textures: ['none', 'starfield', 'filigree', 'runes', 'circuitry'],
    motions: ['motes', 'orbit', 'shimmer', 'drift', 'pulse'],
    fills: ['void', 'radial', 'veil', 'vignette'],
    palettes: ['inverted', 'obsidian', 'natural', 'duotone'],
    adj: ['Zenith', 'Solstice', 'Meridian', 'Starfall', 'Comet', 'Aurora', 'Empyrean', 'Celestial', 'Perihelion', 'Nova', 'Halo', 'Vault'],
    noun: ['Orrery', 'Zenith', 'Ecliptic', 'Halo', 'Vault', 'Meridian', 'Conjunction', 'Aureole', 'Compass', 'Ascension'],
    epithet: ['the Turning Sky', 'Fixed Stars', 'the Long Orbit', 'Two Moons', 'the Outer Dark'],
  },
  prismatic: {
    id: 'prismatic', label: 'Prismatic',
    frames: ['plain', 'crystalline', 'shard', 'coffin', 'lotus', 'spire', 'reliquary'],
    textures: ['none', 'lattice', 'flakes', 'filigree', 'starfield', 'circuitry'],
    motions: ['shimmer', 'sweep', 'motes', 'sparks', 'orbit'],
    fills: ['radial', 'frosted', 'veil', 'gradient'],
    palettes: ['natural', 'inverted', 'duotone', 'bleached'],
    adj: ['Refracted', 'Faceted', 'Prism', 'Spectra', 'Geode', 'Quartz', 'Lucent', 'Kaleidos', 'Splitlight', 'Beryl', 'Cleave', 'Brilliant'],
    noun: ['Prism', 'Facet', 'Geode', 'Cleavage', 'Spectrum', 'Lens', 'Cabochon', 'Matrix', 'Refraction', 'Quartz'],
    epithet: ['Split Light', 'the Perfect Cut', 'Every Angle', 'the Growing Lattice', 'Seven Colours'],
  },
};

export function getTheme(id: ThemeId): Theme { return THEMES[id]; }
export const THEME_LIST = THEME_IDS.map((id) => THEMES[id]);

/**
 * Which theme a school leans on when nothing is assigned. Cross-pollination
 * is half the fun in the lab, so this is only a default -- `telluric`,
 * `arcane` and `astral` have no school of their own and exist purely to be
 * picked by hand.
 */
export const SCHOOL_THEME: Record<string, ThemeId> = {
  fire: 'infernal',
  ice: 'glacial',
  dark: 'void',
  sword: 'martial',
  druid: 'verdant',
  crystalmancer: 'prismatic',
};

// ─── Sampling helpers ──────────────────────────────────────────────────────

const pick = <T,>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

/**
 * Index into an ordered plain->elaborate list by grade, with a little
 * jitter so two grade-0.8 cards don't come out identical.
 */
function pickByGrade<T>(rand: () => number, xs: readonly T[], grade: number, jitter = 0.18): T {
  const g = Math.min(0.999, Math.max(0, grade + (rand() * 2 - 1) * jitter));
  return xs[Math.floor(g * xs.length)];
}

// ─── Generation ────────────────────────────────────────────────────────────

export interface GenerateOptions {
  /** 0..1 power reading. Defaults to random. */
  grade?: number;
  /** Affinity bundle to sample from. Defaults to random. */
  theme?: ThemeId;
}

export function generateRecipe(seed: number, opts: GenerateOptions = {}): CardRecipe {
  const rand = seededRandom(seed);
  const grade = opts.grade ?? rand();
  const theme = THEMES[opts.theme ?? pick(rand, THEME_IDS)];

  const frame = pickByGrade(rand, theme.frames, grade) as FrameId;
  const texture = (grade < 0.12 ? 'none' : pickByGrade(rand, theme.textures, grade)) as TextureId;

  // Motion is the loudest signal on the card, so it stays locked behind
  // grade entirely: nothing moves below ~0.3, and only the top band gets
  // three simultaneous layers.
  const motionCount = grade < 0.28 ? 0 : grade < 0.5 ? 1 : grade < 0.78 ? (rand() < 0.55 ? 1 : 2) : (rand() < 0.5 ? 2 : 3);
  const motion: MotionId[] = [];
  for (let i = 0; i < motionCount; i++) {
    const m = pick(rand, theme.motions);
    if (!motion.includes(m)) motion.push(m);
  }

  const border: BorderId = grade < 0.15 ? (rand() < 0.4 ? 'none' : 'flat')
    : grade < 0.45 ? 'flat'
    : grade < 0.7 ? (rand() < 0.5 ? 'double' : 'inlaid')
    : pick(rand, ['double', 'inlaid', 'glowline'] as const);

  const sigilRing: SigilRingId = grade < 0.12 ? (rand() < 0.5 ? 'none' : 'conic')
    : grade < 0.4 ? pick(rand, ['conic', 'dashed'] as const)
    : grade < 0.72 ? pick(rand, ['conic', 'double', 'halo'] as const)
    : pick(rand, ['double', 'halo', 'orbitals'] as const);

  const corner: CornerId = grade < 0.16 ? 'none'
    : grade < 0.38 ? (rand() < 0.5 ? 'pips' : 'none')
    : grade < 0.62 ? pick(rand, ['pips', 'gems'] as const)
    : pick(rand, ['gems', 'runes', 'filigree'] as const);

  const recipe: CardRecipe = {
    id: '', // filled below, needs the name
    name: '',
    grade,
    frame,
    border,
    borderWidth: 1 + Math.round(grade * 2.4),
    fill: pickByGrade(rand, theme.fills, grade, 0.3) as FillId,
    paletteMod: pickByGrade(rand, theme.palettes, grade, 0.35) as PaletteModId,
    texture,
    textureDensity: Math.min(1, 0.18 + grade * 0.72 + (rand() - 0.5) * 0.2),
    motion,
    motionRate: Math.min(1, 0.25 + grade * 0.75 + (rand() - 0.5) * 0.18),
    sigilRing,
    sigilHalo: Math.min(1, 0.15 + grade * 0.85 + (rand() - 0.5) * 0.15),
    corner,
    nameCase: (grade > 0.62 && rand() < 0.45 ? (rand() < 0.5 ? 'upper' : 'wide') : 'normal') as NameCaseId,
    // Squared so the outer bloom is genuinely reserved for the top end --
    // if everything glows, nothing does.
    aura: grade * grade,
    auraPulse: grade > 0.58 && rand() < 0.7,
    seed,
  };

  recipe.name = nameFor(recipe, theme, seed);
  recipe.id = slugify(recipe.name, seed);
  return recipe;
}

/** Deterministic recipe for a spell that has no bank assignment -- keyed off its own id, school and tier. */
export function fallbackRecipe(spellId: string, school: string | undefined, tier: number, maxTier = 13): CardRecipe {
  const grade = Math.min(1, Math.max(0, (tier - 1) / Math.max(1, maxTier - 1)));
  return generateRecipe(seedFromString(spellId, 7717), {
    grade,
    theme: (school && SCHOOL_THEME[school]) || 'arcane',
  });
}

// ─── Naming ────────────────────────────────────────────────────────────────

/** Fragments contributed by the loudest single axis, so the name reports what you can actually see. */
const MOTION_ADJ: Record<MotionId, string> = {
  snow: 'Snowfall', embers: 'Emberfall', motes: 'Driftlight', ash: 'Ashfall',
  sparks: 'Spark', rain: 'Rainfall', orbit: 'Orbiting', pulse: 'Pulsing',
  sweep: 'Sweeping', shimmer: 'Shimmering', drift: 'Drifting', crackle: 'Crackling',
};

const FRAME_NOUN: Record<FrameId, string> = {
  plain: 'Card', jagged: 'Brand', crystalline: 'Facet', torn: 'Scrap', beveled: 'Edge',
  rough: 'Slab', arch: 'Arch', obelisk: 'Obelisk', fang: 'Fang', shard: 'Shard',
  coffin: 'Casket', tablet: 'Tablet', spire: 'Spire', lotus: 'Lotus', reliquary: 'Reliquary',
};

function nameFor(r: CardRecipe, theme: Theme, seed: number): string {
  const rand = seededRandom(seed ^ 0x5f3a);
  const rarity = rarityForGrade(r.grade).id;

  // Prefer a motion-derived adjective when the card actually moves -- that's
  // the thing you notice first -- otherwise fall back to the theme's own.
  const adj = r.motion.length > 0 && rand() < 0.5
    ? MOTION_ADJ[r.motion[0]]
    : pick(rand, theme.adj);

  // High-grade frames are distinctive enough to name themselves; low-grade
  // ones borrow a noun from the theme so "Rime Card" never happens.
  const noun = FRAME_ELABORATION[r.frame] > 0.45 && rand() < 0.6
    ? FRAME_NOUN[r.frame]
    : pick(rand, theme.noun);

  const head = `${adj} ${noun}`;
  return (rarity === 'legendary' || rarity === 'mythic') && rand() < 0.55
    ? `${head} of ${pick(rand, theme.epithet)}`
    : head;
}

function slugify(name: string, seed: number): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${base}-${(seed >>> 0).toString(36).slice(-4)}`;
}

// ─── Bulk generation ───────────────────────────────────────────────────────

export interface BatchOptions extends GenerateOptions {
  count: number;
  /** Base seed; each recipe in the batch derives from it deterministically. */
  seed: number;
  /** When set, grades are spread evenly across this range instead of sampled. */
  gradeRange?: [number, number];
}

/** A deterministic batch. Same seed + options always yields the same set, so a card you liked is always findable again. */
export function generateBatch(opts: BatchOptions): CardRecipe[] {
  const { count, seed, gradeRange, ...rest } = opts;
  const out: CardRecipe[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < count; i++) {
    const grade = rest.grade ?? (gradeRange
      // Spread across the band rather than sampling, so a batch always shows
      // the full plain -> ornate ramp instead of clustering in the middle.
      ? gradeRange[0] + ((i + 0.5) / count) * (gradeRange[1] - gradeRange[0])
      : undefined);

    const r = generateRecipe(seed + i * 2654435761, { ...rest, grade });
    // Names collide occasionally across a big batch; disambiguate rather
    // than dropping, since the recipe itself is still distinct.
    if (seen.has(r.name)) {
      r.name = `${r.name} ${romanize((seen.size % 8) + 2)}`;
      r.id = slugify(r.name, r.seed);
    }
    seen.add(r.name);
    out.push(r);
  }
  return out;
}

function romanize(n: number): string {
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1] ?? String(n);
}
