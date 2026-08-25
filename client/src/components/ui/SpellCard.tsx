/**
 * A spell rendered as a stylized card. Everything about how the card *looks*
 * -- silhouette, fill, engraved texture, live particles, sigil ring, corner
 * ornament, aura -- comes from a CardRecipe (see data/cardRecipe.ts), either
 * assigned by hand in the Design Lab or generated deterministically from the
 * spell's tier. The point of routing it through a recipe is that ornament
 * scales with power, so a late-game hotbar sorts itself visually: tier-1
 * cards are plain and still, capstones are worked and alive.
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
import { seedFromString } from '../../utils/cardSeed';
import { frameClip, frameInset } from '../../data/cardFrames';
import { NULL_RECIPE, cardScale, type CardRecipe } from '../../data/cardRecipe';
import { useSpellRecipe } from '../../stores/cardRecipeStore';
import { CardFace, CardSigil, auraFilter, nameStyle, useCardPalette } from './CardArt';

const SNAPPY = 'cubic-bezier(0.34, 1.56, 0.64, 1)'; // "back out" -- slight overshoot, settles fast
const GREY_BG = '#2b2b31';
const GREY_ICON = '#7a7a86';
const GREY_FRAME = '#4a4a54';

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
  /** Label to show for a non-castable skill-tree node (a passive) that has
   * no SpellDef -- e.g. glossary entries. Ignored when `spell` is set. */
  displayName?: string;
  /** Icon/glow color for a `displayName` card, since passives have no
   * SpellDef color of their own -- typically the wizard's class color. */
  accentColor?: string;
  /** Force a specific look instead of the spell's assigned/generated one.
   * Used by the Design Lab to preview a candidate recipe. */
  recipeOverride?: CardRecipe;
  /** Replace the card's name text. The Design Lab shows the *recipe's* name
   * here, since in the lab a card is a look rather than a spell. */
  labelOverride?: string;
  /** Preview mode: render as though hovered, so motion and aura are visible
   * without the pointer being over the card. */
  forceLit?: boolean;
  /** Opt out of rarity-driven sizing and use `width`/`height` exactly. For
   * grids that need even columns (the Design Lab, the skill tree) where a
   * mythic growing 38% would break the layout. */
  fixedSize?: boolean;
}

export function SpellCard({
  spellId, spell, slotLabel, cooldownSec, cooldownPct, active, onClick,
  width: baseWidth = 92, height: baseHeight = 120, displayName, accentColor,
  recipeOverride, labelOverride, forceLit, fixedSize,
}: SpellCardProps) {
  const [hovered, setHovered] = useState(false);
  const [justCast, setJustCast] = useState(false);
  const prevOnCooldown = useRef(false);

  const resolved = useSpellRecipe(spellId, spell);
  const recipe = recipeOverride ?? resolved ?? NULL_RECIPE;

  const kind = spellId ? iconKindForSpellId(spellId) : 'passive';
  const label = labelOverride ?? spell?.name ?? displayName ?? null;

  // Rarity buys footprint: a mythic card is meaningfully bigger than a
  // tier-1 starter sitting next to it in the hotbar, which is a power tell
  // that lands before you've read anything. It also pays for the longer
  // names and more deeply cusped frames that high grades come with.
  const inset = frameInset(recipe.frame);
  const scale = fixedSize ? 1 : cardScale(recipe, inset);
  const width = Math.round(baseWidth * scale);
  const height = Math.round(baseHeight * scale);

  // Horizontal room the silhouette actually leaves for text.
  const padX = Math.round(6 + (width / 2) * inset);
  const sigilSize = Math.round(Math.min(44 * scale, width - padX * 2 - 4));

  const color = spell ? spell.color : accentColor ?? '#333';
  const glow = spell ? spell.glowColor : accentColor ?? '#333';
  const palette = useCardPalette(recipe, color, glow);

  const onCooldown = cooldownPct > 0;
  const fillPct = Math.min(1, Math.max(0, 1 - cooldownPct));
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
  const lit = !!(forceLit || active || hoverLift);
  const clip = frameClip(recipe.frame);

  // Cooldown reuses the recipe's silhouette but strips it back to grey --
  // the flood then repaints the real palette from the bottom up.
  const greyRecipe = useMemo<CardRecipe>(() => ({ ...recipe, motion: [], corner: 'none', aura: 0 }), [recipe]);
  const greyPalette = useMemo(() => ({ base: GREY_FRAME, deep: GREY_BG, accent: '#5a5a64', glow: '#6e6e7a', ink: '#9a9aa6' }), []);

  return (
    <div
      data-ww-card
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
        filter: label ? auraFilter(recipe, palette, lit) : undefined,
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
      {/* Flip stage */}
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        transformStyle: 'preserve-3d',
        transition: `transform 260ms ${SNAPPY}`,
        transform: onCooldown ? 'rotateY(180deg)' : 'rotateY(0deg)',
      }}>
        {/* ---------- FRONT (face up, ready) ---------- */}
        <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
          {label ? (
            <CardFace recipe={recipe} palette={palette} lit={lit} boost={lit ? 1.35 : 1}>
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: `0 ${padX}px`, textAlign: 'center',
              }}>
                <CardSigil recipe={recipe} palette={palette} size={sigilSize} lit={lit}>
                  <SpellTypeIcon
                    kind={kind}
                    size={Math.round(sigilSize * 0.55)}
                    color={legibleAccent(palette.accent, palette.glow)}
                    style={{ filter: `drop-shadow(0 0 4px ${palette.glow}bb)` }}
                  />
                </CardSigil>
                <div style={{
                  marginTop: 5, color: palette.ink,
                  textShadow: `0 1px 3px rgba(0,0,0,0.9)`,
                  ...nameStyle(recipe, label, width - padX * 2, height * 0.34),
                }}>
                  {label}
                </div>
              </div>
            </CardFace>
          ) : (
            <>
              <div style={{ position: 'absolute', inset: 0, clipPath: clip, WebkitClipPath: clip, background: '#333' }} />
              <div style={{
                position: 'absolute', inset: 2, clipPath: clip, WebkitClipPath: clip,
                background: 'rgba(10,10,16,0.85)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ fontSize: 10, color: '#555' }}>Empty</div>
              </div>
            </>
          )}
        </div>

        {/* ---------- BACK (face down, on cooldown: greyscale, floods with the spell's color as it recharges) ---------- */}
        <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
          <CardFace recipe={greyRecipe} palette={greyPalette}>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <SpellTypeIcon kind={kind} size={26} color={GREY_ICON} />
            </div>

            {/* Colored flood, clipped from the bottom up as the cooldown finishes */}
            <div style={{
              position: 'absolute', inset: 0, overflow: 'hidden',
              clipPath: `inset(${(1 - fillPct) * 100}% 0% 0% 0%)`,
              transition: 'clip-path 100ms linear',
            }}>
              <div style={{
                position: 'absolute', inset: 0,
                background: `linear-gradient(160deg, ${palette.base}55 0%, rgba(8,8,14,0.96) 60%)`,
              }} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SpellTypeIcon
                  kind={kind}
                  size={26}
                  color={legibleAccent(palette.accent, palette.glow)}
                  style={{ filter: `drop-shadow(0 0 5px ${palette.glow}cc)` }}
                />
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
          </CardFace>
        </div>
      </div>

      {/* Idle "alive" breathing halo for the currently active, ready slot */}
      {active && !onCooldown && spell && (
        <div style={{
          position: 'absolute', inset: -4, borderRadius: 10, pointerEvents: 'none',
          boxShadow: `0 0 14px ${palette.glow}88`,
          animation: `ww-ca-aura 2.6s ease-in-out -${breatheDelay}ms infinite`,
        }} />
      )}
    </div>
  );
}
