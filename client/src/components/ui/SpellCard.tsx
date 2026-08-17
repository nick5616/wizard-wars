/**
 * A spell rendered as a stylized card instead of a plain colored box: a
 * per-school frame silhouette (clip-path), a procedurally-seeded background
 * pattern unique to the spell (so two fire spells don't look identical to
 * each other, just related), a rarity gem keyed off tier, and the same
 * info the old hotbar slot showed (name, type, cooldown) plus a bit more
 * (status effect, rarity). Design tokens live in data/spellCardThemes.json;
 * the frame shapes themselves are in data/cardFrames.ts.
 */

import { useMemo } from 'react';
import type { SpellDef } from '../../types/game.types';
import { SpellTypeIcon, iconKindForSpellId } from './SpellTypeIcon';
import { legibleAccent } from '../../utils/legibleColor';
import { seedFromString, seededRandom } from '../../utils/cardSeed';
import { CARD_FRAME_CLIP, DEFAULT_FRAME_CLIP } from '../../data/cardFrames';
import cardThemes from '../../data/spellCardThemes.json';

interface SchoolTheme { frame: string; cornerGlyph: string; patternSalt: number; }
interface RarityTier { maxTier: number; name: string; gem: string; }

const SCHOOLS = cardThemes.schools as Record<string, SchoolTheme>;
const RARITY_TIERS = cardThemes.rarityTiers as RarityTier[];

function rarityFor(tier: number): RarityTier {
  return RARITY_TIERS.find((r) => tier <= r.maxTier) ?? RARITY_TIERS[RARITY_TIERS.length - 1];
}

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

export function SpellCard({ spellId, spell, slotLabel, cooldownSec, cooldownPct, active, onClick, width = 78, height = 100 }: SpellCardProps) {
  const school = spell?.school ? SCHOOLS[spell.school] : null;
  const clipPath = school ? (CARD_FRAME_CLIP[school.frame] ?? DEFAULT_FRAME_CLIP) : DEFAULT_FRAME_CLIP;
  const rarity = spell ? rarityFor(spell.tier ?? 1) : null;
  const kind = spellId ? iconKindForSpellId(spellId) : 'passive';

  const color = spell ? spell.color : '#333';
  const glow = spell ? spell.glowColor : '#333';
  const textColor = spell ? legibleAccent(color, glow) : '#666';

  const pattern = useMemo(
    () => (spellId ? buildPattern(seedFromString(spellId, school?.patternSalt ?? 0)) : []),
    [spellId, school?.patternSalt],
  );

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        width,
        height,
        cursor: onClick ? 'pointer' : 'default',
        pointerEvents: onClick ? 'all' : 'none',
        filter: active ? `drop-shadow(0 0 8px ${glow}aa)` : 'none',
        transition: 'filter 0.15s',
        flexShrink: 0,
      }}
    >
      {/* Frame: the colored outer sliver that reads as a "border" around the clipped silhouette */}
      <div style={{
        position: 'absolute', inset: 0,
        clipPath, WebkitClipPath: clipPath,
        background: active ? color : `${color}99`,
      }} />

      {/* Face: inset card interior */}
      <div style={{
        position: 'absolute', inset: 2,
        clipPath, WebkitClipPath: clipPath,
        background: spell
          ? `linear-gradient(160deg, ${color}33 0%, rgba(8,8,14,0.96) 55%)`
          : 'rgba(10,10,16,0.85)',
        overflow: 'hidden',
      }}>
        {/* Seeded decorative pattern -- unique per spell, not just per school */}
        {spell && pattern.length > 0 && (
          <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }} preserveAspectRatio="none" viewBox="0 0 100 100">
            {pattern.map((l, i) => (
              <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={glow} strokeWidth={0.6} opacity={l.opacity} />
            ))}
          </svg>
        )}

        {/* Cooldown fill */}
        {cooldownPct > 0 && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, width: '100%',
            height: `${cooldownPct * 100}%`,
            background: 'rgba(0,0,0,0.68)',
            transition: 'height 0.1s linear',
          }} />
        )}

        {/* Rarity gem */}
        {rarity && (
          <div style={{
            position: 'absolute', top: 4, left: 4,
            width: 6, height: 6, borderRadius: '50%',
            background: rarity.gem, boxShadow: `0 0 4px ${rarity.gem}`,
          }} title={rarity.name} />
        )}

        {/* Slot key */}
        <div style={{ position: 'absolute', top: 3, left: 13, fontSize: 9, color: '#888' }}>{slotLabel}</div>

        {/* Type icon + school glyph */}
        <div style={{ position: 'absolute', top: 3, right: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
          {school && <span style={{ fontSize: 8, color: `${color}cc` }}>{school.cornerGlyph}</span>}
          {spell && <SpellTypeIcon kind={kind} size={11} color="#999" />}
        </div>

        {/* Center content */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '0 6px', textAlign: 'center',
        }}>
          {spell ? (
            <>
              <div style={{
                width: 16, height: 16, borderRadius: '50%',
                background: color, boxShadow: `0 0 7px ${glow}`, marginBottom: 4,
              }} />
              <div style={{ fontSize: 10.5, color: textColor, lineHeight: 1.15 }}>{spell.name}</div>
              {spell.statusEffect && (
                <div style={{ fontSize: 8, color: '#aa88ff', marginTop: 2, letterSpacing: 0.5 }}>+{spell.statusEffect}</div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 10, color: '#555' }}>Empty</div>
          )}
        </div>

        {/* Cooldown countdown */}
        {cooldownSec > 0 && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            fontSize: 15, fontWeight: 'bold', color: '#fff', textShadow: '0 1px 3px #000', zIndex: 2,
          }}>
            {cooldownSec.toFixed(1)}
          </div>
        )}
      </div>
    </div>
  );
}
