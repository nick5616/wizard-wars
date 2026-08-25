/**
 * At-a-glance glyph for how a spell works, used everywhere a spell shows up
 * in a list/row (hotbar, pause menu, skill tree, experiment lab). One glyph
 * per SpellDef.type, plus 'passive' for skill-tree nodes that aren't a real
 * cast at all (getSpell() returns null for those).
 */

import { getSpell } from 'shared/spells';
import type { SpellType } from '../../types/game.types';

export type IconKind = SpellType | 'passive';

export function iconKindForSpellId(id: string | null | undefined): IconKind {
  if (!id) return 'passive';
  const spell = getSpell(id);
  return spell ? spell.type : 'passive';
}

const LABELS: Record<IconKind, string> = {
  melee: 'Melee — close range, must swing at your foe',
  hitscan: 'Hitscan — instant, requires a clear line of sight',
  projectile: 'Projectile — travels through the air, can be dodged or timed',
  arc: 'Arc — lobbed, falls under gravity, so aim high for distance',
  aoe: 'Area of effect — damages everyone in a zone',
  domain: 'Domain — arena-wide ultimate effect',
  beam: 'Beam — continuous channeled damage',
  direct: 'Direct — applied straight to a locked target, no travel time',
  mobility: 'Mobility — movement ability',
  passive: 'Passive — always-on effect, not cast',
  rune: 'Rune — placed on the ground, detonates on the first enemy to step in it',
  defensive: 'Defensive — Q. One per class: a shield, barrier, or counter.',
};

interface Props {
  kind: IconKind;
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function SpellTypeIcon({ kind, size = 14, color = 'currentColor', className, style }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, ...style }}
    >
      <title>{LABELS[kind]}</title>
      {glyph(kind)}
    </svg>
  );
}

/** Same glyph, but as bare SVG children for embedding inside an existing <svg> (e.g. SkillTree's tree). */
export function SpellTypeGlyph({ kind }: { kind: IconKind }) {
  return <>{glyph(kind)}</>;
}

function glyph(kind: IconKind) {
  switch (kind) {
    case 'melee': // sword
      return (
        <>
          <line x1="4" y1="20" x2="16" y2="8" />
          <path d="M14 6l4-4 4 4-4 4z" fill="currentColor" stroke="none" />
          <line x1="3" y1="15" x2="7" y2="19" />
          <line x1="6.5" y1="11.5" x2="9.5" y2="14.5" />
        </>
      );
    case 'hitscan': // crosshair
      return (
        <>
          <circle cx="12" cy="12" r="5.5" />
          <line x1="12" y1="1.5" x2="12" y2="6" />
          <line x1="12" y1="18" x2="12" y2="22.5" />
          <line x1="1.5" y1="12" x2="6" y2="12" />
          <line x1="18" y1="12" x2="22.5" y2="12" />
        </>
      );
    case 'projectile': // arrow — travels, takes time
      return (
        <>
          <line x1="3" y1="21" x2="17" y2="7" />
          <path d="M11 7h6v6" />
        </>
      );
    case 'arc': // lobbed trajectory -- rises, then falls onto the target
      return (
        <>
          <path d="M2.5 20.5 C5.5 6.5, 15 3.5, 20 12.5" />
          <circle cx="20.5" cy="13.5" r="2.2" fill="currentColor" stroke="none" />
        </>
      );
    case 'aoe': // bomb
      return (
        <>
          <circle cx="10.5" cy="14.5" r="6.5" />
          <line x1="14.5" y1="9.5" x2="18" y2="6" />
          <circle cx="19" cy="5" r="1.3" fill="currentColor" stroke="none" />
        </>
      );
    case 'domain': // hemisphere / dome, tilted
      return (
        <>
          <path d="M2.5 17a9.5 5 0 0 1 19 0" />
          <ellipse cx="12" cy="17" rx="9.5" ry="3" />
        </>
      );
    case 'beam': // continuous channel
      return (
        <>
          <line x1="3" y1="20" x2="21" y2="4" strokeWidth={2.6} />
          <line x1="5.5" y1="14.5" x2="10" y2="10.5" strokeWidth={1} opacity={0.55} />
          <line x1="14" y1="9" x2="18.5" y2="5" strokeWidth={1} opacity={0.55} />
        </>
      );
    case 'direct': // locked-on instant application
      return (
        <>
          <path d="M12 2.5l9.5 9.5-9.5 9.5-9.5-9.5z" />
          <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
        </>
      );
    case 'mobility': // dash
      return (
        <>
          <line x1="2.5" y1="18" x2="8" y2="18" opacity={0.4} />
          <line x1="5.5" y1="13" x2="12" y2="13" opacity={0.7} />
          <path d="M11 6.5l9 6.5-9 6.5z" fill="currentColor" stroke="none" />
        </>
      );
    case 'rune': // sigil — diamond with an inner mark, placed-on-ground trap
      return (
        <>
          <path d="M12 2.5l8 9.5-8 9.5-8-9.5z" />
          <circle cx="12" cy="12" r="2.6" />
        </>
      );
    case 'defensive': // shield
      return (
        <path d="M12 2.5l8 3.2v6.3c0 5-3.4 8.4-8 9.5-4.6-1.1-8-4.5-8-9.5V5.7z" />
      );
    case 'passive':
    default: // star
      return <path d="M12 2.5l2.7 6.4 6.9.6-5.2 4.6 1.6 6.8L12 17.4l-6 3.5 1.6-6.8-5.2-4.6 6.9-.6z" />;
  }
}
