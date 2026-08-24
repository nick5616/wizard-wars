/**
 * A spell rendered as a stylized card instead of a plain colored box: a
 * per-school frame silhouette (clip-path), a procedurally-seeded background
 * pattern unique to the spell (so two fire spells don't look identical to
 * each other, just related), and -- deliberately minimal -- just the name
 * and a glowing type glyph in the center. Design tokens live in
 * data/spellCardThemes.json; the frame shapes themselves are in
 * data/cardFrames.ts.
 *
 * The card is a real 3D flip: casting rotates it face-down onto a greyscale
 * back face that floods back to full color (bottom-up) as the cooldown
 * finishes, then it flips back face-up. All motion uses a "back out"
 * cubic-bezier so it overshoots slightly and settles -- reads as snappy
 * rather than a linear UI tween. The active slot also pushes its neighbors
 * away with a bit of extra margin, so it visibly separates from the row.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SpellDef } from '../../types/game.types';
import { SpellTypeIcon, iconKindForSpellId } from './SpellTypeIcon';
import { legibleAccent } from '../../utils/legibleColor';
import { seedFromString, seededRandom } from '../../utils/cardSeed';
import { CARD_FRAME_CLIP, DEFAULT_FRAME_CLIP } from '../../data/cardFrames';
import cardThemes from '../../data/spellCardThemes.json';

interface SchoolTheme { frame: string; cornerGlyph: string; patternSalt: number; }

const SCHOOLS = cardThemes.schools as Record<string, SchoolTheme>;

const SNAPPY = 'cubic-bezier(0.34, 1.56, 0.64, 1)'; // "back out" -- slight overshoot, settles fast
const GREY_BG = '#2b2b31';
const GREY_LINE = '#5a5a64';
const GREY_ICON = '#7a7a86';
const GREY_FRAME = '#4a4a54';

interface DecoLine { x1: number; y1: number; x2: number; y2: number; opacity: number; }

/** A handful of thin diagonal accent lines, positioned deterministically from the spell's own id -- stable across renders, distinct per spell. */
function buildPattern(seed: number): DecoLine[] {
  const rand = seededRandom(seed);
  const count = 4 + Math.floor(rand() * 3); // 4-6
  const lines: DecoLine[] = [];
  for (let i = 0; i < count; i++) {
    const x1 = rand() * 100, y1 = rand() * 100;
    const len = 15 + rand() * 35;
    const angle = rand() * Math.PI * 2;
    lines.push({
      x1, y1,
      x2: x1 + Math.cos(angle) * len,
      y2: y1 + Math.sin(angle) * len,
      opacity: 0.12 + rand() * 0.18,
    });
  }
  return lines;
}

export interface SpellCardProps {
  spellId: string | null;
  spell: SpellDef | null;
  slotLabel: string;
  cooldownSec: number;
  cooldownPct: number;
  active?: boolean;
  onClick?: () => void;
  width?: number;
  height?: number;
}

export function SpellCard({ spellId, spell, slotLabel, cooldownSec, cooldownPct, active, onClick, width = 92, height = 120 }: SpellCardProps) {
  const [hovered, setHovered] = useState(false);
  const [justCast, setJustCast] = useState(false);
  const prevOnCooldown = useRef(false);

  const school = spell?.school ? SCHOOLS[spell.school] : null;
  const clipPath = school ? (CARD_FRAME_CLIP[school.frame] ?? DEFAULT_FRAME_CLIP) : DEFAULT_FRAME_CLIP;
  const kind = spellId ? iconKindForSpellId(spellId) : 'passive';

  const color = spell ? spell.color : '#333';
  const glow = spell ? spell.glowColor : '#333';
  const textColor = spell ? legibleAccent(color, glow) : '#666';

  const pattern = useMemo(
    () => (spellId ? buildPattern(seedFromString(spellId, school?.patternSalt ?? 0)) : []),
    [spellId, school?.patternSalt],
  );

  const onCooldown = cooldownPct > 0;
  const fillPct = Math.min(1, Math.max(0, 1 - cooldownPct));
  const spinDelay = spellId ? seedFromString(spellId, 91) % 4000 : 0;
  const breatheDelay = spellId ? seedFromString(spellId, 47) % 3400 : 0;
  const interactive = !!onClick;

  // Punchy little pop the instant a card goes on cooldown (i.e. the spell was just cast).
  useEffect(() => {
    if (onCooldown && !prevOnCooldown.current) {
      setJustCast(true);
      const t = setTimeout(() => setJustCast(false), 220);
      return () => clearTimeout(t);
    }
    prevOnCooldown.current = onCooldown;
  }, [onCooldown]);

  const hoverLift = interactive && hovered && !onCooldown;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => interactive && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        width,
        height,
        cursor: onClick ? 'pointer' : 'default',
        pointerEvents: onClick ? 'all' : 'none',
        perspective: 700,
        filter: active ? `drop-shadow(0 0 10px ${glow}cc)` : hoverLift ? `drop-shadow(0 0 7px ${glow}99)` : 'none',
        transition: `filter 150ms ease, transform ${justCast ? '160ms' : '180ms'} ${SNAPPY}, margin 220ms ${SNAPPY}`,
        transform: justCast
          ? 'scale(1.14)'
          : hoverLift ? 'translateY(-5px) scale(1.07)'
          : active ? 'translateY(-4px) scale(1.05)' : 'translateY(0) scale(1)',
        marginLeft: active ? 10 : 0,
        marginRight: active ? 10 : 0,
        flexShrink: 0,
      }}
    >
      <style>{`
        @keyframes ww-spellcard-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes ww-spellcard-breathe { 0%, 100% { transform: scale(1); opacity: 0.85; } 50% { transform: scale(1.08); opacity: 1; } }
      `}</style>

      {/* Flip stage */}
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        transformStyle: 'preserve-3d',
        transition: `transform 260ms ${SNAPPY}`,
        transform: onCooldown ? 'rotateY(180deg)' : 'rotateY(0deg)',
      }}>
        {/* ---------- FRONT (face up, ready) ---------- */}
        <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, clipPath, WebkitClipPath: clipPath, background: active ? color : `${color}99` }} />
          <div style={{
            position: 'absolute', inset: 2, clipPath, WebkitClipPath: clipPath, overflow: 'hidden',
            background: spell ? `linear-gradient(160deg, ${color}33 0%, rgba(8,8,14,0.96) 55%)` : 'rgba(10,10,16,0.85)',
          }}>
            {spell && pattern.length > 0 && (
              <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }} preserveAspectRatio="none" viewBox="0 0 100 100">
                {pattern.map((l, i) => (
                  <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={glow} strokeWidth={0.6} opacity={l.opacity} />
                ))}
              </svg>
            )}

            {/* Center content: big glowing type symbol instead of a plain color dot */}
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '0 6px', textAlign: 'center',
            }}>
              {spell ? (
                <>
                  <div style={{ position: 'relative', width: 44, height: 44, marginBottom: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{
                      position: 'absolute', inset: 0, borderRadius: '50%',
                      background: `radial-gradient(circle, ${glow}59 0%, ${color}22 45%, transparent 74%)`,
                      filter: 'blur(0.5px)',
                    }} />
                    <div style={{
                      position: 'absolute', inset: 5, borderRadius: '50%',
                      background: `conic-gradient(from 0deg, transparent, ${glow}70, transparent 65%)`,
                      opacity: active || hoverLift ? 0.9 : 0.5,
                      animation: `ww-spellcard-spin ${active ? '3.2s' : '6s'} linear -${spinDelay}ms infinite`,
                    }} />
                    <div style={{
                      position: 'absolute', inset: 10, borderRadius: '50%',
                      background: 'rgba(6,6,10,0.72)', boxShadow: `inset 0 0 6px ${glow}55`,
                    }} />
                    <SpellTypeIcon kind={kind} size={24} color={color} style={{ position: 'relative', filter: `drop-shadow(0 0 4px ${glow}bb)` }} />
                  </div>
                  <div style={{ fontSize: 12, color: textColor, lineHeight: 1.15, fontWeight: 600 }}>{spell.name}</div>
                </>
              ) : (
                <div style={{ fontSize: 10, color: '#555' }}>Empty</div>
              )}
            </div>
          </div>
        </div>

        {/* ---------- BACK (face down, on cooldown: greyscale, floods with the spell's color as it recharges) ---------- */}
        <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
          <div style={{ position: 'absolute', inset: 0, clipPath, WebkitClipPath: clipPath, background: GREY_FRAME }} />
          <div style={{ position: 'absolute', inset: 2, clipPath, WebkitClipPath: clipPath, overflow: 'hidden', background: GREY_BG }}>
            {/* Greyscale base art */}
            {pattern.length > 0 && (
              <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }} preserveAspectRatio="none" viewBox="0 0 100 100">
                {pattern.map((l, i) => (
                  <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={GREY_LINE} strokeWidth={0.6} opacity={l.opacity} />
                ))}
              </svg>
            )}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <SpellTypeIcon kind={kind} size={26} color={GREY_ICON} />
            </div>

            {/* Colored flood, clipped from the bottom up as the cooldown finishes */}
            <div style={{
              position: 'absolute', inset: 0, overflow: 'hidden',
              clipPath: `inset(${(1 - fillPct) * 100}% 0% 0% 0%)`,
              transition: 'clip-path 100ms linear',
            }}>
              <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(160deg, ${color}55 0%, rgba(8,8,14,0.96) 60%)` }} />
              {pattern.length > 0 && (
                <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }} preserveAspectRatio="none" viewBox="0 0 100 100">
                  {pattern.map((l, i) => (
                    <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={glow} strokeWidth={0.6} opacity={l.opacity} />
                  ))}
                </svg>
              )}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SpellTypeIcon kind={kind} size={26} color={color} style={{ filter: `drop-shadow(0 0 5px ${glow}cc)` }} />
              </div>
            </div>

            {cooldownSec > 0 && (
              <div style={{
                position: 'absolute', bottom: 6, left: 0, width: '100%', textAlign: 'center',
                fontSize: 17, fontWeight: 'bold', color: '#fff', textShadow: '0 1px 3px #000',
              }}>
                {cooldownSec.toFixed(1)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Idle "alive" breathing halo for the currently active, ready slot */}
      {active && !onCooldown && spell && (
        <div style={{
          position: 'absolute', inset: -4, borderRadius: 10, pointerEvents: 'none',
          boxShadow: `0 0 14px ${glow}88`,
          animation: `ww-spellcard-breathe 2.6s ease-in-out -${breatheDelay}ms infinite`,
        }} />
      )}
    </div>
  );
}
