/**
 * Resolves a spell's two authored colours (`color`, `glowColor`) plus a
 * recipe's `paletteMod` into the five tones CardArt actually paints with.
 *
 * The reason this exists rather than using color/glowColor directly: those
 * are tuned for 3D particles, not UI. Amaterasu's near-black '#1a0000' base
 * under a hot '#ff0000' glow is the single most striking card in the game,
 * and that's not luck -- it's a very dark body carrying a saturated light
 * source. `paletteMod: 'obsidian'` reproduces that relationship on any
 * school's colours, and the other mods are the same trick pointed elsewhere.
 */

import { legibleAccent } from './legibleColor';

export interface CardPalette {
  /** Body/frame colour -- the card's "material". */
  base: string;
  /** Deepest tone, used for the interior floor. */
  deep: string;
  /** Mid accent for texture strokes and ornament. */
  accent: string;
  /** Brightest tone -- glows, halos, aura. Always the light source. */
  glow: string;
  /** Guaranteed-legible tone for the name text. */
  ink: string;
}

import type { PaletteModId } from '../data/cardRecipe';

// ─── hex <-> hsl ───────────────────────────────────────────────────────────

interface HSL { h: number; s: number; l: number; }

function toRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function toHsl(hex: string): HSL {
  const [r255, g255, b255] = toRgb(hex);
  const r = r255 / 255, g = g255 / 255, b = b255 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function fromHsl({ h, s, l }: HSL): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(1, Math.max(0, s));
  const lig = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  const seg = Math.floor(hue / 60) % 6;
  const [r, g, b] = (
    [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]] as const
  )[seg];
  const hx = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

const shift = (hex: string, d: Partial<HSL>): string => {
  const c = toHsl(hex);
  return fromHsl({ h: c.h + (d.h ?? 0), s: c.s + (d.s ?? 0), l: c.l + (d.l ?? 0) });
};

/** Alpha-suffix a hex colour. `a` is 0..1. */
export function alpha(hex: string, a: number): string {
  const v = Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, '0');
  return `${hex}${v}`;
}

// ─── The mods ──────────────────────────────────────────────────────────────

export function resolvePalette(color: string, glowColor: string, mod: PaletteModId): CardPalette {
  let base: string, deep: string, accent: string, glow: string;

  switch (mod) {
    // Deep-black body, saturated light source. The Amaterasu relationship.
    case 'obsidian':
      base = shift(color, { l: -0.3, s: -0.15 });
      deep = shift(color, { l: -0.42, s: -0.3 });
      accent = shift(glowColor, { l: -0.12, s: 0.1 });
      glow = shift(glowColor, { s: 0.18, l: 0.04 });
      break;
    // Frost-bitten: pale, desaturated body with a cold clean highlight.
    case 'bleached':
      base = shift(color, { l: 0.22, s: -0.3 });
      deep = shift(color, { l: -0.18, s: -0.2 });
      accent = shift(color, { l: 0.3, s: -0.1 });
      glow = shift(glowColor, { l: 0.24, s: -0.08 });
      break;
    // Body takes the glow tone, highlight takes the body tone -- reads as
    // lit from inside rather than from outside.
    case 'inverted':
      base = shift(glowColor, { l: -0.12 });
      deep = shift(glowColor, { l: -0.36, s: -0.1 });
      accent = shift(color, { l: 0.12 });
      glow = shift(color, { l: 0.2, s: 0.12 });
      break;
    // Two-tone: the accent swings to the complementary hue for a hard
    // colour clash (works well for dark/void schools).
    case 'duotone':
      base = shift(color, { l: -0.2 });
      deep = shift(color, { l: -0.38, s: 0.05 });
      accent = shift(glowColor, { h: 150, s: 0.15 });
      glow = shift(glowColor, { s: 0.12, l: 0.06 });
      break;
    // Everything drained toward grey except a small ember of the glow.
    case 'ashen':
      base = shift(color, { s: -0.5, l: -0.14 });
      deep = shift(color, { s: -0.6, l: -0.34 });
      accent = shift(color, { s: -0.4, l: 0.08 });
      glow = shift(glowColor, { s: -0.15, l: 0.02 });
      break;
    case 'natural':
    default:
      base = color;
      deep = shift(color, { l: -0.28, s: -0.05 });
      accent = shift(color, { l: 0.1 });
      glow = glowColor;
      break;
  }

  return { base, deep, accent, glow, ink: legibleAccent(accent, glow) };
}
