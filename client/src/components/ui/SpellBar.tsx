import { useGameStore } from '../../stores/gameStore';
import { getSpell, MOBILITY_SPELL, MAX_SPELL_SLOTS, isEquippableSpell } from 'shared/spells';
import { SpellCard } from './SpellCard';

export function SpellBar() {
  const { local, setActiveSlot } = useGameStore();

  const mobilitySpellId = local.class ? MOBILITY_SPELL[local.class] : null;
  const mobilitySpell = mobilitySpellId ? getSpell(mobilitySpellId) : null;
  const mobilityCD = mobilitySpellId ? (local.cooldowns[mobilitySpellId] ?? 0) : 0;

  // Only show as many slots as spells unlocked so far -- the 5th slot opens
  // once a 5th spell is unlocked, and so on up to MAX_SPELL_SLOTS.
  const unlockedCount = local.unlockedNodes.filter((id) => {
    const s = getSpell(id);
    return s && s.class === local.class && isEquippableSpell(s);
  }).length;
  const visibleSlots = Math.min(unlockedCount, MAX_SPELL_SLOTS);

  return (
    <div style={{
      position: 'fixed',
      bottom: 28,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      gap: 10,
      alignItems: 'flex-end',
      pointerEvents: 'none',
      zIndex: 100,
    }}>
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
          width={68}
          height={88}
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
