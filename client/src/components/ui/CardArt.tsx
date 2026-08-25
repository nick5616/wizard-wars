/**
 * Renders a CardRecipe. Everything here is a layer stacked inside the card's
 * clip-path silhouette, bottom to top: fill, engraved texture, live motion,
 * corner ornament. The centrepiece sigil is exported separately so SpellCard
 * can put its type glyph inside it.
 *
 * Two constraints shaped the implementation:
 *
 * - All motion is CSS keyframes on transform/opacity only. A late-game
 *   hotbar can show ~15 cards at once and this sits on top of a running 3D
 *   scene, so nothing here is allowed to touch the JS frame budget. No rAF,
 *   no state updates, no layout-triggering properties.
 * - Particle positions and texture marks are seeded from the recipe, not
 *   Math.random, so a card looks the same every time you see it. That's what
 *   makes a card identifiable rather than just decorative.
 *
 * The viewBox is 100x130 with preserveAspectRatio="none", which is close
 * enough to the real card aspect (~0.77) that circles stay round.
 */

import { useMemo } from 'react';
import { seededRandom } from '../../utils/cardSeed';
import { alpha, resolvePalette, type CardPalette } from '../../utils/cardPalette';
import { frameClip } from '../../data/cardFrames';
import { rarityForGrade, type CardRecipe, type MotionId, type TextureId } from '../../data/cardRecipe';

export type { CardPalette };

const VB = { w: 100, h: 130 };

// ─── Keyframes ─────────────────────────────────────────────────────────────
// Injected once into <head> rather than per-card: a 15-card hotbar would
// otherwise mount 15 identical <style> blocks.

const KEYFRAMES = `
@keyframes ww-ca-fall   { 0% { transform: translate3d(0,-18%,0); opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } 100% { transform: translate3d(var(--ww-drift, 0px),120%,0); opacity: 0; } }
@keyframes ww-ca-rise   { 0% { transform: translate3d(0,118%,0) scale(1); opacity: 0; } 15% { opacity: 1; } 80% { opacity: 0.7; } 100% { transform: translate3d(var(--ww-drift, 0px),-18%,0) scale(0.4); opacity: 0; } }
@keyframes ww-ca-float  { 0%, 100% { transform: translate3d(0,0,0); opacity: 0.35; } 50% { transform: translate3d(var(--ww-drift, 4px),-14px,0); opacity: 1; } }
@keyframes ww-ca-spark  { 0%, 82%, 100% { opacity: 0; transform: scale(0.4); } 86% { opacity: 1; transform: scale(1.5); } 92% { opacity: 0.5; transform: scale(0.9); } }
@keyframes ww-ca-spin   { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes ww-ca-spinr  { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
@keyframes ww-ca-pulse  { 0%, 100% { transform: scale(0.92); opacity: 0.28; } 50% { transform: scale(1.12); opacity: 0.7; } }
@keyframes ww-ca-sweep  { 0% { transform: translate3d(-120%,0,0); } 100% { transform: translate3d(220%,0,0); } }
@keyframes ww-ca-shim   { 0%, 100% { opacity: 0.12; } 50% { opacity: 0.5; } }
@keyframes ww-ca-crack  { 0%, 100% { opacity: 0; } 4% { opacity: 0.9; } 8% { opacity: 0.1; } 11% { opacity: 0.75; } 16% { opacity: 0; } }
@keyframes ww-ca-aura   { 0%, 100% { opacity: 0.55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.035); } }
@keyframes ww-ca-orbit  { from { transform: rotate(0deg) translateX(var(--ww-r, 16px)) rotate(0deg); } to { transform: rotate(360deg) translateX(var(--ww-r, 16px)) rotate(-360deg); } }

/* A late-game hotbar can run a dozen particle layers at once. For anyone who
   has asked the OS for less movement, freeze every layer where it stands
   rather than removing it: each particle keeps its own negative start delay,
   so the composition still reads -- snow suspended in the air, embers
   mid-rise -- it just stops moving. */
@media (prefers-reduced-motion: reduce) {
  [data-ww-card], [data-ww-card] * {
    animation-play-state: paused !important;
    transition: none !important;
  }
}
`;

let injected = false;
function ensureKeyframes() {
  if (injected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.dataset.wwCardArt = 'true';
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
  injected = true;
}

// ─── Texture ───────────────────────────────────────────────────────────────

/**
 * Static engraved marks. Each texture is a different *kind* of mark, not
 * just a different density of the same one -- that's what lets a card read
 * as "cracked stone" vs "circuit-etched" at a glance.
 */
function TextureLayer({ recipe, palette }: { recipe: CardRecipe; palette: CardPalette }) {
  const marks = useMemo(
    () => buildTexture(recipe.texture, recipe.seed, recipe.textureDensity),
    [recipe.texture, recipe.seed, recipe.textureDensity],
  );
  if (!marks) return null;

  return (
    <svg
      width="100%" height="100%" viewBox={`0 0 ${VB.w} ${VB.h}`} preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      stroke={palette.accent} fill="none" strokeLinecap="round"
    >
      {marks}
    </svg>
  );
}

function buildTexture(texture: TextureId, seed: number, density: number) {
  if (texture === 'none') return null;
  const rand = seededRandom(seed ^ 0x7a1e);
  const n = (min: number, max: number) => Math.round(min + (max - min) * density);
  const out: JSX.Element[] = [];
  const o = (base: number) => base * (0.55 + density * 0.65);

  switch (texture) {
    case 'diagonals': {
      for (let i = 0; i < n(3, 9); i++) {
        const x = rand() * VB.w, y = rand() * VB.h;
        const len = 18 + rand() * 44, a = rand() * Math.PI * 2;
        out.push(<line key={i} x1={x} y1={y} x2={x + Math.cos(a) * len} y2={y + Math.sin(a) * len} strokeWidth={0.6} opacity={o(0.28)} />);
      }
      break;
    }
    case 'cracks': {
      // Branching polylines from a random origin -- reads as fractured.
      for (let i = 0; i < n(2, 5); i++) {
        let x = rand() * VB.w, y = rand() * VB.h;
        let a = rand() * Math.PI * 2;
        const pts = [`${x.toFixed(1)},${y.toFixed(1)}`];
        for (let s = 0; s < 4 + Math.floor(rand() * 4); s++) {
          a += (rand() - 0.5) * 1.5;
          x += Math.cos(a) * (6 + rand() * 12);
          y += Math.sin(a) * (6 + rand() * 12);
          pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
        out.push(<polyline key={i} points={pts.join(' ')} strokeWidth={0.5 + rand() * 0.5} opacity={o(0.3)} />);
      }
      break;
    }
    case 'lattice': {
      const step = 26 - density * 12;
      for (let x = step / 2; x < VB.w; x += step) out.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={VB.h} strokeWidth={0.4} opacity={o(0.2)} />);
      for (let y = step / 2; y < VB.h; y += step) out.push(<line key={`h${y}`} x1={0} y1={y} x2={VB.w} y2={y} strokeWidth={0.4} opacity={o(0.2)} />);
      break;
    }
    case 'runes': {
      // Small invented glyphs: a stem with two or three strokes off it.
      for (let i = 0; i < n(3, 9); i++) {
        const x = 12 + rand() * 76, y = 12 + rand() * 106, s = 3 + rand() * 4;
        const d = [`M${x} ${y - s} L${x} ${y + s}`];
        for (let k = 0; k < 2 + Math.floor(rand() * 2); k++) {
          const yy = y - s + rand() * s * 2;
          d.push(`M${x} ${yy} L${x + (rand() < 0.5 ? -s : s) * 0.8} ${yy + (rand() - 0.5) * s}`);
        }
        out.push(<path key={i} d={d.join(' ')} strokeWidth={0.55} opacity={o(0.4)} />);
      }
      break;
    }
    case 'scales': {
      const r = 9 - density * 3;
      let row = 0;
      for (let y = r; y < VB.h + r; y += r * 1.15, row++) {
        for (let x = row % 2 ? 0 : -r; x < VB.w + r; x += r * 2) {
          out.push(<path key={`${x}-${y}`} d={`M${x - r} ${y} A${r} ${r} 0 0 1 ${x + r} ${y}`} strokeWidth={0.4} opacity={o(0.22)} />);
        }
      }
      break;
    }
    case 'filigree': {
      // Mirrored S-curves hugging the left and right edges.
      for (let i = 0; i < n(2, 5); i++) {
        const y = 14 + (i / n(2, 5)) * 100 + rand() * 8;
        const w = 16 + rand() * 14;
        for (const side of [0, 1]) {
          const x0 = side ? VB.w : 0, dir = side ? -1 : 1;
          out.push(
            <path key={`${i}-${side}`} strokeWidth={0.5} opacity={o(0.35)}
              d={`M${x0} ${y} C${x0 + dir * w} ${y - 8}, ${x0 + dir * w * 0.4} ${y + 10}, ${x0 + dir * w * 1.3} ${y + 4}`} />,
          );
        }
      }
      break;
    }
    case 'starfield': {
      for (let i = 0; i < n(8, 34); i++) {
        out.push(<circle key={i} cx={rand() * VB.w} cy={rand() * VB.h} r={0.3 + rand() * 1.1} fill="currentColor" stroke="none" opacity={o(0.5) * (0.3 + rand() * 0.7)} />);
      }
      break;
    }
    case 'flakes': {
      // Six-armed asterisks -- the unmistakable snowflake read.
      for (let i = 0; i < n(3, 10); i++) {
        const x = 10 + rand() * 80, y = 10 + rand() * 110, s = 2.5 + rand() * 4;
        const arms = [0, 1, 2].map((k) => {
          const a = (k * Math.PI) / 3;
          return `M${x - Math.cos(a) * s} ${y - Math.sin(a) * s} L${x + Math.cos(a) * s} ${y + Math.sin(a) * s}`;
        });
        out.push(<path key={i} d={arms.join(' ')} strokeWidth={0.5} opacity={o(0.45)} />);
      }
      break;
    }
    case 'strata': {
      // Horizontal sediment bands with a slow wobble.
      for (let i = 0; i < n(3, 9); i++) {
        const y = (i + 0.5) * (VB.h / n(3, 9));
        out.push(<path key={i} strokeWidth={0.5 + rand() * 0.8} opacity={o(0.25)}
          d={`M0 ${y} Q25 ${y + (rand() - 0.5) * 6}, 50 ${y} T100 ${y + (rand() - 0.5) * 4}`} />);
      }
      break;
    }
    case 'circuitry': {
      // Orthogonal traces terminating in a node.
      for (let i = 0; i < n(3, 8); i++) {
        let x = rand() * VB.w, y = rand() * VB.h;
        const d = [`M${x.toFixed(1)} ${y.toFixed(1)}`];
        for (let s = 0; s < 3; s++) {
          if (s % 2 === 0) x += (rand() - 0.5) * 36; else y += (rand() - 0.5) * 40;
          d.push(`L${x.toFixed(1)} ${y.toFixed(1)}`);
        }
        out.push(<path key={i} d={d.join(' ')} strokeWidth={0.5} opacity={o(0.3)} />);
        out.push(<circle key={`n${i}`} cx={x} cy={y} r={1.1} fill="currentColor" stroke="none" opacity={o(0.5)} />);
      }
      break;
    }
    case 'thorns': {
      for (let i = 0; i < n(3, 9); i++) {
        const x = rand() * VB.w, y = rand() * VB.h;
        const len = 10 + rand() * 18, a = rand() * Math.PI * 2;
        const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
        out.push(<path key={i} strokeWidth={0.5} opacity={o(0.32)}
          d={`M${x} ${y} Q${(x + ex) / 2 + Math.sin(a) * 6} ${(y + ey) / 2 - Math.cos(a) * 6}, ${ex} ${ey}`} />);
      }
      break;
    }
  }
  return out;
}

// ─── Motion ────────────────────────────────────────────────────────────────

interface Particle { x: number; y: number; size: number; delay: number; dur: number; drift: number; op: number; }

function buildParticles(seed: number, count: number): Particle[] {
  const rand = seededRandom(seed);
  return Array.from({ length: count }, () => ({
    x: rand() * 100,
    y: rand() * 100,
    size: 1 + rand() * 2.4,
    // Negative delays start each particle mid-flight, so the effect is
    // already running the instant the card appears rather than fading in.
    delay: -rand() * 8,
    dur: 3.5 + rand() * 5,
    drift: (rand() - 0.5) * 22,
    op: 0.4 + rand() * 0.6,
  }));
}

/** Particle count scales with rate but stays capped -- a full hotbar multiplies this by ~15. */
const particleCount = (rate: number, max: number) => Math.max(3, Math.round(max * (0.35 + rate * 0.65)));

function MotionLayer({ kind, recipe, palette, boost }: {
  kind: MotionId; recipe: CardRecipe; palette: CardPalette; boost: number;
}) {
  const { motionRate, seed } = recipe;
  // Each layer gets its own seed offset so two layers on one card don't
  // emit from identical positions.
  const layerSeed = seed ^ (kind.charCodeAt(0) * 7919);

  const speed = 1 / (0.6 + motionRate * 0.8) / boost;

  switch (kind) {
    case 'snow':
    case 'ash':
    case 'rain': {
      const parts = buildParticles(layerSeed, particleCount(motionRate, kind === 'rain' ? 12 : 14));
      const color = kind === 'ash' ? palette.accent : kind === 'rain' ? palette.glow : palette.glow;
      return (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          {parts.map((p, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${p.x}%`, top: 0,
              width: kind === 'rain' ? 1 : p.size, height: kind === 'rain' ? p.size * 4 : p.size,
              borderRadius: kind === 'rain' ? 0 : '50%',
              background: color, opacity: p.op * (kind === 'ash' ? 0.5 : 0.75),
              boxShadow: kind === 'snow' ? `0 0 3px ${color}` : 'none',
              ['--ww-drift' as string]: `${p.drift}px`,
              animation: `ww-ca-fall ${(p.dur * speed * (kind === 'rain' ? 0.35 : 1)).toFixed(2)}s linear ${p.delay}s infinite`,
            }} />
          ))}
        </div>
      );
    }
    case 'embers': {
      const parts = buildParticles(layerSeed, particleCount(motionRate, 12));
      return (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          {parts.map((p, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${p.x}%`, top: 0,
              width: p.size, height: p.size, borderRadius: '50%',
              background: palette.glow, opacity: p.op,
              boxShadow: `0 0 ${3 + p.size}px ${palette.glow}`,
              ['--ww-drift' as string]: `${p.drift}px`,
              animation: `ww-ca-rise ${(p.dur * speed).toFixed(2)}s ease-out ${p.delay}s infinite`,
            }} />
          ))}
        </div>
      );
    }
    case 'motes':
    case 'drift': {
      const parts = buildParticles(layerSeed, particleCount(motionRate, kind === 'motes' ? 11 : 8));
      return (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          {parts.map((p, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${p.x}%`, top: `${p.y}%`,
              width: p.size, height: p.size, borderRadius: '50%',
              background: kind === 'motes' ? palette.glow : palette.accent,
              boxShadow: kind === 'motes' ? `0 0 ${4 + p.size * 2}px ${palette.glow}` : 'none',
              ['--ww-drift' as string]: `${p.drift * 0.4}px`,
              animation: `ww-ca-float ${(p.dur * speed * 1.6).toFixed(2)}s ease-in-out ${p.delay}s infinite`,
            }} />
          ))}
        </div>
      );
    }
    case 'sparks': {
      const parts = buildParticles(layerSeed, particleCount(motionRate, 9));
      return (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          {parts.map((p, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${p.x}%`, top: `${p.y}%`,
              width: p.size * 1.4, height: p.size * 1.4, borderRadius: '50%',
              background: palette.glow, boxShadow: `0 0 6px ${palette.glow}`,
              animation: `ww-ca-spark ${(p.dur * speed * 1.3).toFixed(2)}s linear ${p.delay}s infinite`,
            }} />
          ))}
        </div>
      );
    }
    case 'orbit': {
      const count = Math.max(2, Math.round(2 + motionRate * 3));
      return (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          {Array.from({ length: count }, (_, i) => (
            <div key={i} style={{
              gridArea: '1 / 1',
              width: 3, height: 3, borderRadius: '50%',
              background: palette.glow, boxShadow: `0 0 5px ${palette.glow}`,
              ['--ww-r' as string]: `${18 + i * 5}px`,
              animation: `ww-ca-orbit ${(4 + i * 1.6) * speed}s linear ${-i * 1.3}s infinite`,
            }} />
          ))}
        </div>
      );
    }
    case 'pulse':
      return (
        <div style={{
          position: 'absolute', inset: '18%', borderRadius: '50%', pointerEvents: 'none',
          background: `radial-gradient(circle, ${alpha(palette.glow, 0.42)} 0%, transparent 68%)`,
          animation: `ww-ca-pulse ${(3.4 * speed).toFixed(2)}s ease-in-out infinite`,
        }} />
      );
    case 'sweep':
      // A specular band travelling across the face, like light on a blade.
      return (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{
            position: 'absolute', top: '-30%', left: 0, width: '45%', height: '160%',
            transform: 'rotate(18deg)',
            background: `linear-gradient(90deg, transparent, ${alpha(palette.glow, 0.3)}, transparent)`,
            animation: `ww-ca-sweep ${(3.6 * speed).toFixed(2)}s ease-in-out infinite`,
          }} />
        </div>
      );
    case 'shimmer':
      return (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `linear-gradient(150deg, transparent 20%, ${alpha(palette.glow, 0.28)} 50%, transparent 80%)`,
          animation: `ww-ca-shim ${(2.8 * speed).toFixed(2)}s ease-in-out infinite`,
        }} />
      );
    case 'crackle': {
      const rand = seededRandom(layerSeed);
      const bolts = Array.from({ length: Math.max(1, Math.round(1 + motionRate * 2)) }, () => {
        let x = 20 + rand() * 60, y = rand() * 30;
        const pts = [`${x.toFixed(1)},${y.toFixed(1)}`];
        for (let i = 0; i < 4; i++) {
          x += (rand() - 0.5) * 26; y += 18 + rand() * 12;
          pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
        return { pts: pts.join(' '), delay: -rand() * 6 };
      });
      return (
        <svg width="100%" height="100%" viewBox={`0 0 ${VB.w} ${VB.h}`} preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {bolts.map((b, i) => (
            <polyline key={i} points={b.pts} fill="none" stroke={palette.glow} strokeWidth={0.9}
              style={{
                filter: `drop-shadow(0 0 2px ${palette.glow})`,
                animation: `ww-ca-crack ${(5 * speed).toFixed(2)}s linear ${b.delay}s infinite`,
              }} />
          ))}
        </svg>
      );
    }
    default:
      return null;
  }
}

// ─── Corner ornament ───────────────────────────────────────────────────────

function CornerOrnament({ recipe, palette }: { recipe: CardRecipe; palette: CardPalette }) {
  if (recipe.corner === 'none') return null;
  const gem = rarityForGrade(recipe.grade).gem;

  if (recipe.corner === 'pips' || recipe.corner === 'gems') {
    const isGem = recipe.corner === 'gems';
    const size = isGem ? 5 : 3;
    return (
      <>
        {[['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']].map(([v, h], i) => (
          <div key={i} style={{
            position: 'absolute', [v]: 5, [h]: 5,
            width: size, height: size,
            background: isGem ? gem : alpha(palette.accent, 0.75),
            transform: 'rotate(45deg)',
            boxShadow: isGem ? `0 0 5px ${gem}` : 'none',
            pointerEvents: 'none',
          } as React.CSSProperties} />
        ))}
      </>
    );
  }

  // 'runes' and 'filigree' draw into the corners with SVG so they can be
  // asymmetric shapes rather than dots.
  const d = recipe.corner === 'runes'
    ? 'M3 8 L3 3 L8 3 M3 5.5 L6 5.5'
    : 'M2 10 C2 4, 4 2, 10 2 M4 8 C4 5.5, 5.5 4, 8 4';
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 130" preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      fill="none" stroke={recipe.corner === 'filigree' ? gem : palette.accent} strokeWidth={0.9} strokeLinecap="round">
      {[
        '',
        'translate(100 0) scale(-1 1)',
        'translate(0 130) scale(1 -1)',
        'translate(100 130) scale(-1 -1)',
      ].map((t, i) => <path key={i} d={d} transform={t || undefined} opacity={0.8} />)}
    </svg>
  );
}

// ─── Fill ──────────────────────────────────────────────────────────────────

function fillBackground(recipe: CardRecipe, p: CardPalette): string {
  switch (recipe.fill) {
    case 'radial':
      return `radial-gradient(ellipse at 50% 38%, ${alpha(p.base, 0.42)} 0%, ${alpha(p.deep, 0.92)} 58%, rgba(6,6,12,0.97) 100%)`;
    case 'vignette':
      return `radial-gradient(ellipse at 50% 50%, ${alpha(p.deep, 0.7)} 0%, rgba(5,5,10,0.99) 92%)`;
    case 'void':
      // Near-total black with only a breath of colour at the top -- the
      // treatment that makes Amaterasu read the way it does.
      return `linear-gradient(180deg, ${alpha(p.base, 0.3)} 0%, rgba(3,3,7,0.99) 45%, #030307 100%)`;
    case 'frosted':
      return `linear-gradient(165deg, ${alpha(p.accent, 0.34)} 0%, ${alpha(p.deep, 0.85)} 45%, rgba(10,14,22,0.96) 100%)`;
    case 'ember':
      // Heat rising from the base of the card.
      return `linear-gradient(0deg, ${alpha(p.glow, 0.34)} 0%, ${alpha(p.deep, 0.8)} 38%, rgba(8,6,8,0.97) 100%)`;
    case 'veil':
      return `linear-gradient(200deg, ${alpha(p.deep, 0.9)} 0%, ${alpha(p.base, 0.3)} 50%, rgba(6,6,12,0.97) 100%)`;
    case 'gradient':
    default:
      return `linear-gradient(160deg, ${alpha(p.base, 0.28)} 0%, rgba(8,8,14,0.96) 55%)`;
  }
}

function borderBackground(recipe: CardRecipe, p: CardPalette, lit: boolean): string {
  switch (recipe.border) {
    case 'none':
      return alpha(p.deep, 0.6);
    case 'double':
      return `linear-gradient(160deg, ${p.accent} 0%, ${alpha(p.deep, 0.9)} 40%, ${p.accent} 100%)`;
    case 'inlaid':
      // Metallic: hard bright/dark stops so it catches like bevelled metal.
      return `linear-gradient(135deg, ${p.glow} 0%, ${alpha(p.deep, 0.95)} 22%, ${p.accent} 50%, ${alpha(p.deep, 0.95)} 78%, ${p.glow} 100%)`;
    case 'glowline':
      return lit ? p.glow : `linear-gradient(160deg, ${p.glow} 0%, ${p.accent} 55%, ${p.glow} 100%)`;
    case 'flat':
    default:
      return lit ? p.base : alpha(p.base, 0.62);
  }
}

// ─── Public surface ────────────────────────────────────────────────────────

export function useCardPalette(recipe: CardRecipe, color: string, glowColor: string): CardPalette {
  return useMemo(() => resolvePalette(color, glowColor, recipe.paletteMod), [color, glowColor, recipe.paletteMod]);
}

export interface CardFaceProps {
  recipe: CardRecipe;
  palette: CardPalette;
  /** Selected/hovered cards get slightly livelier motion and a brighter edge. */
  lit?: boolean;
  /** Multiplier on animation speed; >1 speeds motion up (used on hover). */
  boost?: number;
  children?: React.ReactNode;
}

/**
 * The full card face: silhouette, border, fill, texture, motion, ornament.
 * `children` render on top of all of it, inside the clip.
 */
export function CardFace({ recipe, palette, lit = false, boost = 1, children }: CardFaceProps) {
  ensureKeyframes();
  const clip = frameClip(recipe.frame);
  const inset = recipe.borderWidth;

  return (
    <>
      {/* Border shell -- a filled silhouette the interior sits inside of. */}
      <div style={{
        position: 'absolute', inset: 0, clipPath: clip, WebkitClipPath: clip,
        background: borderBackground(recipe, palette, lit),
      }} />

      {/* Interior */}
      <div style={{
        position: 'absolute', inset, clipPath: clip, WebkitClipPath: clip, overflow: 'hidden',
        background: fillBackground(recipe, palette),
      }}>
        <TextureLayer recipe={recipe} palette={palette} />
        {recipe.motion.map((m) => (
          <MotionLayer key={m} kind={m} recipe={recipe} palette={palette} boost={boost} />
        ))}
        <CornerOrnament recipe={recipe} palette={palette} />
        {children}
      </div>
    </>
  );
}

/**
 * The ring/halo assembly that sits behind a card's type glyph. Separate from
 * CardFace so SpellCard can place its own <SpellTypeIcon> in the middle.
 */
export function CardSigil({ recipe, palette, size = 44, lit = false, children }: {
  recipe: CardRecipe; palette: CardPalette; size?: number; lit?: boolean; children?: React.ReactNode;
}) {
  ensureKeyframes();
  const { sigilRing, sigilHalo, seed } = recipe;
  // Stagger rotation start per card so a row of them isn't in lockstep.
  const spinDelay = -(seed % 4000) / 1000;

  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'grid', placeItems: 'center' }}>
      {sigilHalo > 0.05 && (
        <div style={{
          gridArea: '1 / 1', width: '100%', height: '100%', borderRadius: '50%',
          background: `radial-gradient(circle, ${alpha(palette.glow, 0.16 + sigilHalo * 0.42)} 0%, ${alpha(palette.base, 0.14)} 45%, transparent 74%)`,
        }} />
      )}

      {sigilRing === 'conic' && (
        <div style={{
          gridArea: '1 / 1', width: '78%', height: '78%', borderRadius: '50%',
          background: `conic-gradient(from 0deg, transparent, ${alpha(palette.glow, 0.44)}, transparent 65%)`,
          opacity: lit ? 0.95 : 0.55,
          animation: `ww-ca-spin ${lit ? 3.2 : 6}s linear ${spinDelay}s infinite`,
        }} />
      )}

      {sigilRing === 'dashed' && (
        <div style={{
          gridArea: '1 / 1', width: '82%', height: '82%', borderRadius: '50%',
          border: `1px dashed ${alpha(palette.glow, 0.6)}`,
          animation: `ww-ca-spin ${lit ? 8 : 14}s linear ${spinDelay}s infinite`,
        }} />
      )}

      {sigilRing === 'double' && (
        <>
          <div style={{
            gridArea: '1 / 1', width: '92%', height: '92%', borderRadius: '50%',
            border: `1px solid ${alpha(palette.accent, 0.5)}`,
            animation: `ww-ca-spin ${lit ? 7 : 12}s linear ${spinDelay}s infinite`,
          }} />
          <div style={{
            gridArea: '1 / 1', width: '68%', height: '68%', borderRadius: '50%',
            border: `1px dashed ${alpha(palette.glow, 0.7)}`,
            animation: `ww-ca-spinr ${lit ? 5 : 9}s linear ${spinDelay}s infinite`,
          }} />
        </>
      )}

      {sigilRing === 'halo' && (
        <div style={{
          gridArea: '1 / 1', width: '100%', height: '100%', borderRadius: '50%',
          boxShadow: `0 0 ${6 + sigilHalo * 10}px ${alpha(palette.glow, 0.7)}, inset 0 0 ${4 + sigilHalo * 8}px ${alpha(palette.glow, 0.55)}`,
          border: `1px solid ${alpha(palette.glow, 0.45)}`,
          animation: recipe.auraPulse ? `ww-ca-pulse ${3.2}s ease-in-out ${spinDelay}s infinite` : undefined,
        }} />
      )}

      {sigilRing === 'orbitals' && (
        <>
          <div style={{
            gridArea: '1 / 1', width: '88%', height: '88%', borderRadius: '50%',
            border: `1px solid ${alpha(palette.accent, 0.4)}`,
          }} />
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              gridArea: '1 / 1', width: 2.5, height: 2.5, borderRadius: '50%',
              background: palette.glow, boxShadow: `0 0 4px ${palette.glow}`,
              ['--ww-r' as string]: `${size * 0.44}px`,
              animation: `ww-ca-orbit ${(lit ? 3.4 : 5.5) + i * 0.9}s linear ${-i * 1.5}s infinite`,
            }} />
          ))}
        </>
      )}

      {/* Dark well behind the glyph, so the icon reads against the halo. */}
      <div style={{
        gridArea: '1 / 1', width: '55%', height: '55%', borderRadius: '50%',
        background: 'rgba(6,6,10,0.72)', boxShadow: `inset 0 0 6px ${alpha(palette.glow, 0.4)}`,
      }} />

      <div style={{ gridArea: '1 / 1', display: 'grid', placeItems: 'center' }}>{children}</div>
    </div>
  );
}

/** Outer bloom around the whole card. Reserved for high-grade recipes -- see `aura` in cardRecipe.ts. */
export function auraFilter(recipe: CardRecipe, palette: CardPalette, lit: boolean): string | undefined {
  const strength = recipe.aura * (lit ? 1.5 : 1);
  if (strength < 0.06) return lit ? `drop-shadow(0 0 6px ${alpha(palette.glow, 0.55)})` : undefined;
  return `drop-shadow(0 0 ${(4 + strength * 12).toFixed(1)}px ${alpha(palette.glow, Math.min(0.95, 0.35 + strength * 0.5))})`;
}

/**
 * Name typography, fitted to the space actually available.
 *
 * High-grade recipes earn longer names ("Pulsing Reliquary of the Patient
 * Earth") *and* the ornate frames that steal the most interior width, so a
 * fixed font size clips exactly the cards that most deserve to be readable.
 * Rarity already buys a bigger card (see cardScale); this shrinks the type
 * the rest of the way so the name always lands inside the silhouette.
 */
export function nameStyle(recipe: CardRecipe, label: string, availWidth: number, availHeight: number): React.CSSProperties {
  const base = recipe.nameCase === 'normal' ? 12 : 10.5;
  const tracking = recipe.nameCase === 'wide' ? 1.6 : recipe.nameCase === 'upper' ? 0.6 : 0;

  // Courier is monospace at ~0.6em per glyph; uppercase and tracking widen it.
  const perChar = 0.6 + tracking / base + (recipe.nameCase === 'upper' ? 0.02 : 0);

  // Two independent limits: the longest single word must not overflow a
  // line (words can't break), and the whole string must fit the block.
  const longestWord = label.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 1);
  const byWord = availWidth / (longestWord * perChar);
  const lineHeight = 1.15;
  const byBlock = Math.sqrt((availWidth * availHeight) / (label.length * perChar * lineHeight));

  const fontSize = Math.max(7, Math.min(base, byWord, byBlock));

  return {
    fontSize,
    lineHeight,
    fontWeight: recipe.nameCase === 'upper' ? 700 : 600,
    letterSpacing: tracking,
    textTransform: recipe.nameCase === 'upper' ? 'uppercase' : undefined,
    // Belt and braces: if a name still can't fit, clip it cleanly rather
    // than letting it spill past the clip-path edge.
    overflow: 'hidden',
    maxWidth: availWidth,
  };
}
