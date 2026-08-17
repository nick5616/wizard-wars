/**
 * Per-school card silhouette. `spellCardThemes.json` names which style a
 * school uses ("jagged", "crystalline", ...); this is the CSS clip-path that
 * actually draws it. Kept as code rather than JSON since clip-path values
 * are the one part of the design that isn't meaningfully data -- the theme
 * JSON is what's meant to be tweaked/extended per spell/school.
 */

export const CARD_FRAME_CLIP: Record<string, string> = {
  // Fire: small saw-tooth double-notch top corners, simple angled cut bottom corners.
  jagged: 'polygon(0% 12%, 6% 12%, 6% 4%, 12% 4%, 12% 0%, 88% 0%, 88% 4%, 94% 4%, 94% 12%, 100% 12%, 100% 92%, 92% 100%, 8% 100%, 0% 92%)',
  // Ice: clean symmetric octagon facet, like a cut gem.
  crystalline: 'polygon(10% 0%, 90% 0%, 100% 10%, 100% 90%, 90% 100%, 10% 100%, 0% 90%, 0% 10%)',
  // Dark: irregular asymmetric wavy edges, nothing lines up.
  torn: 'polygon(0% 6%, 5% 0%, 40% 3%, 60% 0%, 95% 4%, 100% 10%, 100% 88%, 94% 100%, 55% 96%, 45% 100%, 8% 97%, 0% 90%)',
  // Sword: single clean 45° bevel at the top corners only, sharp square bottom.
  beveled: 'polygon(14% 0%, 86% 0%, 100% 14%, 100% 100%, 0% 100%, 0% 14%)',
  // Earth: chunky blocky notches with little tabs top/bottom center.
  rough: 'polygon(0% 16%, 16% 0%, 40% 0%, 40% 6%, 60% 6%, 60% 0%, 84% 0%, 100% 16%, 100% 84%, 88% 100%, 60% 100%, 60% 94%, 40% 94%, 40% 100%, 12% 100%, 0% 84%)',
};

export const DEFAULT_FRAME_CLIP = 'polygon(6% 0%, 94% 0%, 100% 6%, 100% 94%, 94% 100%, 6% 100%, 0% 94%, 0% 6%)';
