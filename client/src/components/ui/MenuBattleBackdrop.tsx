/**
 * Landing-screen background: the pause menu's "two wizards trading spells"
 * rig (BattleScene) reused verbatim, driven by an internal timer instead of
 * a hovered spell -- there's no selected class yet on the main menu, so this
 * just cycles through every class + one animatable signature spell per
 * class, Pokemon-battle style, forever.
 */

import { useEffect, useState } from 'react';
import { BattleScene } from './BattleScene';
import { ALL_SPELLS } from 'shared/spells';
import type { SpellDef, SpellType, WizardClass } from '../../types/game.types';

const ALL_CLASSES: WizardClass[] = ['fire', 'ice', 'dark', 'sword', 'druid', 'crystalmancer'];

// Only these SpellTypes have an entry in BattleScene's CAST_PROFILES -- arc/
// passive/mobility/defensive spells never get an arm-rig cast animation
// there, so they're skipped when picking a class's demo spell.
const CAST_ANIMATED_TYPES = new Set<SpellType>(['projectile', 'hitscan', 'direct', 'beam', 'aoe', 'domain', 'melee', 'rune']);

function pickSignatureSpell(wizardClass: WizardClass): SpellDef | null {
  const match = Object.values(ALL_SPELLS as Record<string, SpellDef>).find(
    (s) => s.class === wizardClass && CAST_ANIMATED_TYPES.has(s.type),
  );
  return match ?? null;
}

const SIGNATURE_SPELL: Record<WizardClass, SpellDef | null> = Object.fromEntries(
  ALL_CLASSES.map((c) => [c, pickSignatureSpell(c)]),
) as Record<WizardClass, SpellDef | null>;

const CYCLE_MS = 3400; // how long each class/spell pairing plays before advancing

export function MenuBattleBackdrop() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIdx((i) => i + 1), CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  const myClass = ALL_CLASSES[idx % ALL_CLASSES.length];
  const spell = SIGNATURE_SPELL[myClass];

  return <BattleScene myClass={myClass} hoveredSpell={spell} idleGemColor="#9a8cff" />;
}
