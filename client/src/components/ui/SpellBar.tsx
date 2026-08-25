import { useLayoutEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { getSpell, MOBILITY_SPELL, DEFENSIVE_SPELL, MAX_SPELL_SLOTS, isEquippableSpell } from 'shared/spells';
import { SpellCard } from './SpellCard';

/** Fraction of the viewport the hotbar is allowed to occupy before it shrinks to fit. */
const MAX_BAR_WIDTH_FRACTION = 0.94;

export function SpellBar() {
  const { local, setActiveSlot } = useGameStore();

  const mobilitySpellId = local.class ? MOBILITY_SPELL[local.class] : null;
  const mobilitySpell = mobilitySpellId ? getSpell(mobilitySpellId) : null;
  const mobilityCD = mobilitySpellId ? (local.cooldowns[mobilitySpellId] ?? 0) : 0;

  const defensiveSpellId = local.class ? DEFENSIVE_SPELL[local.class] : null;
  const defensiveSpell = defensiveSpellId ? getSpell(defensiveSpellId) : null;
  const defensiveCD = defensiveSpellId ? (local.cooldowns[defensiveSpellId] ?? 0) : 0;

  // Only show as many slots as spells unlocked so far -- the 5th slot opens
  // once a 5th spell is unlocked, and so on up to MAX_SPELL_SLOTS.
  const unlockedCount = local.unlockedNodes.filter((id) => {
    const s = getSpell(id);
    return s && s.class === local.class && isEquippableSpell(s);
  }).length;
  const visibleSlots = Math.min(unlockedCount, MAX_SPELL_SLOTS);

  // Cards are no longer a fixed width -- rarity scales them (see cardScale),
  // so a full late-game bar of high-rarity spells can be half again as wide
  // as it used to be and run off a narrow screen. Measure the natural width
  // and shrink the whole row uniformly if it doesn't fit, which keeps the
  // *relative* size differences (the whole point of rarity scaling) intact.
  const rowRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;

    const measure = () => {
      // scrollWidth is a layout measurement, so it reports the row's natural
      // width regardless of the CSS transform already applied -- no need to
      // divide the current scale back out.
      const natural = el.scrollWidth;
      const budget = window.innerWidth * MAX_BAR_WIDTH_FRACTION;
      setFitScale(natural > budget ? budget / natural : 1);
    };
    measure();

    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [visibleSlots, local.equippedSpells, mobilitySpellId, defensiveSpellId]);

  return (
    <div
      ref={rowRef}
      style={{
        position: 'fixed',
        bottom: 28,
        left: '50%',
        transform: `translateX(-50%) scale(${fitScale})`,
        transformOrigin: 'bottom center',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-end',
        pointerEvents: 'none',
        zIndex: 100,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{
          fontSize: 11, letterSpacing: 3, textTransform: 'uppercase',
          color: mobilitySpell ? `${mobilitySpell.color}dd` : '#888',
          marginBottom: 4, textShadow: '0 1px 3px rgba(0,0,0,0.8)',
        }}>
          Shift
        </div>
        <SpellCard
          spellId={mobilitySpellId}
          spell={mobilitySpell}
          slotLabel="⇧"
          cooldownSec={mobilityCD / 1000}
          cooldownPct={mobilitySpell ? (mobilityCD / 1000) / mobilitySpell.cooldown : 0}
          width={82}
          height={106}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{
          fontSize: 11, letterSpacing: 3, textTransform: 'uppercase',
          color: defensiveSpell ? `${defensiveSpell.color}dd` : '#888',
          marginBottom: 4, textShadow: '0 1px 3px rgba(0,0,0,0.8)',
        }}>
          Q
        </div>
        <SpellCard
          spellId={defensiveSpellId}
          spell={defensiveSpell}
          slotLabel="Q"
          cooldownSec={defensiveCD / 1000}
          cooldownPct={defensiveSpell ? (defensiveCD / 1000) / defensiveSpell.cooldown : 0}
          width={82}
          height={106}
        />
      </div>

      {local.equippedSpells.slice(0, visibleSlots).map((spellId, i) => {
        const spell = spellId ? getSpell(spellId) : null;
        const cd = spellId ? (local.cooldowns[spellId] ?? 0) : 0;
        const cdSec = cd / 1000;
        const totalCd = spell?.cooldown ?? 1;

        return (
          <SpellCard
            key={i}
            spellId={spellId}
            spell={spell}
            slotLabel={String(i < 9 ? i + 1 : 0)}
            cooldownSec={cdSec}
            cooldownPct={cdSec / totalCd}
            active={i === local.activeSlot}
            onClick={() => setActiveSlot(i)}
          />
        );
      })}
    </div>
  );
}
