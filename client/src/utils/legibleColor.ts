/**
 * A spell's `color` is tuned for how it looks as a 3D particle/effect —
 * several are deliberately near-black (Amaterasu's "black fire" is
 * '#1a0000') so they read as ominous against the arena. That's exactly
 * wrong for UI text/accents on this game's dark panels: near-black text on
 * a near-black background is just invisible. `glowColor` is reliably
 * brighter (it's the highlight/emissive tone), so anywhere a spell's color
 * drives on-screen TEXT rather than a 3D mesh, run it through this first.
 */

function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Text/accent-safe variant of a spell's color: itself if legible against a dark UI, otherwise its glowColor. */
export function legibleAccent(color: string, glowColor: string, threshold = 0.12): string {
  try {
    return relativeLuminance(color) < threshold ? glowColor : color;
  } catch {
    return color;
  }
}
