/**
 * Card silhouettes, as CSS clip-paths. Kept as code rather than JSON since
 * clip-path polygons are the one part of the design that isn't meaningfully
 * data -- they're geometry, not tuning knobs.
 *
 * Frames are ordered roughly by elaborateness: the generator biases
 * high-grade recipes toward the later entries so a capstone spell reads as a
 * more worked object than a tier-1 starter (see FRAME_ELABORATION).
 */

import type { FrameId } from './cardRecipe';

export const CARD_FRAME_CLIP: Record<string, string> = {
  // Simple rounded-corner rectangle -- the neutral baseline.
  plain: 'polygon(6% 0%, 94% 0%, 100% 6%, 100% 94%, 94% 100%, 6% 100%, 0% 94%, 0% 6%)',
  // Fire: small saw-tooth double-notch top corners, simple angled cut bottom corners.
  jagged: 'polygon(0% 12%, 6% 12%, 6% 4%, 12% 4%, 12% 0%, 88% 0%, 88% 4%, 94% 4%, 94% 12%, 100% 12%, 100% 92%, 92% 100%, 8% 100%, 0% 92%)',
  // Ice: clean symmetric octagon facet, like a cut gem.
  crystalline: 'polygon(10% 0%, 90% 0%, 100% 10%, 100% 90%, 90% 100%, 10% 100%, 0% 90%, 0% 10%)',
  // Dark: irregular asymmetric wavy edges, nothing lines up.
  torn: 'polygon(0% 6%, 5% 0%, 40% 3%, 60% 0%, 95% 4%, 100% 10%, 100% 88%, 94% 100%, 55% 96%, 45% 100%, 8% 97%, 0% 90%)',
  // Sword: single clean 45 degree bevel at the top corners only, sharp square bottom.
  beveled: 'polygon(14% 0%, 86% 0%, 100% 14%, 100% 100%, 0% 100%, 0% 14%)',
  // Chunky blocky notches with little tabs top/bottom center.
  rough: 'polygon(0% 16%, 16% 0%, 40% 0%, 40% 6%, 60% 6%, 60% 0%, 84% 0%, 100% 16%, 100% 84%, 88% 100%, 60% 100%, 60% 94%, 40% 94%, 40% 100%, 12% 100%, 0% 84%)',
  // Cathedral arch -- rounded shoulders rising to a flat crown, square footing.
  arch: 'polygon(50% 0%, 68% 2%, 82% 8%, 93% 19%, 99% 34%, 100% 50%, 100% 100%, 0% 100%, 0% 50%, 1% 34%, 7% 19%, 18% 8%, 32% 2%)',
  // Tall standing stone: narrow chamfered top, flared base.
  obelisk: 'polygon(28% 0%, 72% 0%, 86% 9%, 92% 22%, 92% 84%, 100% 94%, 100% 100%, 0% 100%, 0% 94%, 8% 84%, 8% 22%, 14% 9%)',
  // Downward tooth -- wide shoulders tapering to a point at the bottom.
  fang: 'polygon(8% 0%, 92% 0%, 100% 10%, 96% 62%, 74% 88%, 50% 100%, 26% 88%, 4% 62%, 0% 10%)',
  // Splintered crystal, deliberately off-axis on both sides.
  shard: 'polygon(18% 0%, 74% 3%, 100% 16%, 92% 44%, 100% 72%, 78% 100%, 22% 97%, 0% 82%, 8% 50%, 0% 22%)',
  // Hexagonal casket -- widest at the shoulders, tapering both ways.
  coffin: 'polygon(50% 0%, 88% 12%, 100% 30%, 100% 70%, 88% 88%, 50% 100%, 12% 88%, 0% 70%, 0% 30%, 12% 12%)',
  // Inscribed slab: heavy square body with a small stepped plinth top and bottom.
  tablet: 'polygon(0% 8%, 10% 8%, 10% 0%, 90% 0%, 90% 8%, 100% 8%, 100% 92%, 90% 92%, 90% 100%, 10% 100%, 10% 92%, 0% 92%)',
  // Rising point with buttressed shoulders and a stepped base -- a small tower.
  spire: 'polygon(50% 0%, 62% 8%, 76% 10%, 88% 18%, 88% 30%, 100% 40%, 100% 88%, 90% 88%, 90% 100%, 10% 100%, 10% 88%, 0% 88%, 0% 40%, 12% 30%, 12% 18%, 24% 10%, 38% 8%)',
  // Petal-cut: soft cusped shoulders, pointed crown and foot.
  lotus: 'polygon(50% 0%, 66% 10%, 84% 6%, 92% 22%, 100% 36%, 92% 50%, 100% 64%, 92% 78%, 84% 94%, 66% 90%, 50% 100%, 34% 90%, 16% 94%, 8% 78%, 0% 64%, 8% 50%, 0% 36%, 8% 22%, 16% 6%, 34% 10%)',
  // The most worked shape: crowned housing with finials, recessed waist, footed base.
  reliquary: 'polygon(50% 0%, 58% 5%, 70% 4%, 72% 10%, 84% 12%, 88% 22%, 96% 28%, 92% 40%, 100% 50%, 92% 60%, 96% 72%, 88% 78%, 84% 88%, 72% 90%, 70% 96%, 58% 95%, 50% 100%, 42% 95%, 30% 96%, 28% 90%, 16% 88%, 12% 78%, 4% 72%, 8% 60%, 0% 50%, 8% 40%, 4% 28%, 12% 22%, 16% 12%, 28% 10%, 30% 4%, 42% 5%)',
};

export const DEFAULT_FRAME_CLIP = CARD_FRAME_CLIP.plain;

export function frameClip(frame: FrameId | string | undefined): string {
  return (frame && CARD_FRAME_CLIP[frame]) || DEFAULT_FRAME_CLIP;
}

/**
 * How ornate each frame reads, 0..1. The generator uses this to pick a frame
 * near a recipe's grade, so silhouette alone carries some of the power
 * signal before any colour or motion is applied.
 */
export const FRAME_ELABORATION: Record<FrameId, number> = {
  plain: 0.0,
  beveled: 0.1,
  crystalline: 0.15,
  tablet: 0.25,
  jagged: 0.3,
  rough: 0.35,
  torn: 0.4,
  coffin: 0.5,
  fang: 0.55,
  obelisk: 0.6,
  shard: 0.65,
  arch: 0.7,
  spire: 0.82,
  lotus: 0.9,
  reliquary: 1.0,
};

/**
 * How much of the interior each silhouette eats, 0..1, as a fraction of the
 * card's half-width. The elaborate frames aren't just decorative outlines --
 * `lotus` and `reliquary` cusp inward at the waist and `fang` tapers to a
 * point, so text laid out to the card's full width gets clipped by the
 * clip-path. Content is padded by this, and the card's footprint grows by a
 * share of it (see cardScale), so an ornate frame doesn't cost legibility.
 */
export const FRAME_CONTENT_INSET: Record<FrameId, number> = {
  plain: 0.0,
  beveled: 0.0,
  tablet: 0.02,
  crystalline: 0.04,
  jagged: 0.04,
  rough: 0.08,
  torn: 0.06,
  arch: 0.08,
  obelisk: 0.16,
  coffin: 0.14,
  shard: 0.10,
  spire: 0.12,
  fang: 0.20,
  lotus: 0.18,
  reliquary: 0.22,
};

export function frameInset(frame: FrameId | string | undefined): number {
  return (frame ? FRAME_CONTENT_INSET[frame as FrameId] : undefined) ?? 0;
}

/** The frame each school falls back to when a spell has no assigned recipe. */
export const SCHOOL_DEFAULT_FRAME: Record<string, FrameId> = {
  fire: 'jagged',
  ice: 'crystalline',
  dark: 'torn',
  sword: 'beveled',
  druid: 'lotus',
  crystalmancer: 'shard',
};
