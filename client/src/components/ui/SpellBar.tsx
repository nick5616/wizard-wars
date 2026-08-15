import { useGameStore } from '../../stores/gameStore';
import { getSpell, MOBILITY_SPELL } from 'shared/spells';
import { SpellTypeIcon } from './SpellTypeIcon';

export function SpellBar() {
  const { local, setActiveSlot } = useGameStore();

  const mobilitySpellId = local.class ? MOBILITY_SPELL[local.class] : null;
  const mobilitySpell = mobilitySpellId ? getSpell(mobilitySpellId) : null;
  const mobilityCD = mobilitySpellId ? (local.cooldowns[mobilitySpellId] ?? 0) : 0;
  const mobilityCDSec = mobilityCD / 1000;
  const mobilityCDPct = mobilitySpell ? mobilityCDSec / mobilitySpell.cooldown : 0;

  return (
    <div style={{
      position: 'fixed',
      bottom: 32,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      gap: 8,
      alignItems: 'flex-end',
      pointerEvents: 'none',
      zIndex: 100,
    }}>
      {/* Mobility slot (Shift key) */}
      <div style={{
        width: 56,
        height: 56,
        background: 'rgba(0,0,0,0.7)',
        border: `2px solid ${mobilitySpell ? mobilitySpell.color + '88' : '#333'}`,
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        marginRight: 4,
        boxShadow: mobilitySpell && mobilityCDPct === 0 ? `0 0 10px ${mobilitySpell.color}44` : 'none',
      }}>
        {/* Cooldown overlay */}
        {mobilityCDPct > 0 && (
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: `${mobilityCDPct * 100}%`,
            background: 'rgba(0,0,0,0.65)',
            pointerEvents: 'none',
            transition: 'height 0.1s linear',
          }} />
        )}
        {mobilitySpell && (
          <div style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: mobilitySpell.color,
            boxShadow: `0 0 6px ${mobilitySpell.glowColor}`,
            marginBottom: 3,
          }} />
        )}
        <div style={{ fontSize: 10, color: mobilitySpell ? '#ddd' : '#555', textAlign: 'center', padding: '0 3px', lineHeight: 1.1 }}>
          {mobilitySpell ? mobilitySpell.name : 'SHIFT'}
        </div>
        {mobilityCDSec > 0 && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: 13,
            fontWeight: 'bold',
            color: '#fff',
            textShadow: '0 1px 3px #000',
            zIndex: 2,
          }}>
            {mobilityCDSec.toFixed(1)}
          </div>
        )}
        <div style={{ position: 'absolute', top: 2, left: 4, fontSize: 10, color: '#666' }}>⇧</div>
        {mobilitySpell && (
          <SpellTypeIcon
            kind="mobility"
            size={12}
            color="#999"
            style={{ position: 'absolute', top: 3, right: 4 }}
          />
        )}
      </div>

      {local.equippedSpells.map((spellId, i) => {
        const spell = spellId ? getSpell(spellId) : null;
        const cd = spellId ? (local.cooldowns[spellId] ?? 0) : 0;
        const cdSec = cd / 1000;
        const totalCd = spell?.cooldown ?? 1;
        const cdPct = cdSec / totalCd;
        const active = i === local.activeSlot;

        return (
          <div
            key={i}
            onClick={() => setActiveSlot(i)}
            style={{
              width: 64,
              height: 64,
              background: active ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.7)',
              border: active ? `2px solid ${spell?.color ?? '#fff'}` : '2px solid #333',
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              pointerEvents: 'all',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: active && spell ? `0 0 12px ${spell.color}44` : 'none',
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
          >
            {/* Cooldown overlay */}
            {cdPct > 0 && (
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                width: '100%',
                height: `${cdPct * 100}%`,
                background: 'rgba(0,0,0,0.6)',
                pointerEvents: 'none',
                transition: 'height 0.1s linear',
              }} />
            )}

            {/* Spell color dot */}
            {spell && (
              <div style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: spell.color,
                boxShadow: `0 0 8px ${spell.glowColor}`,
                marginBottom: 4,
              }} />
            )}

            {/* Spell name */}
            <div style={{
              fontSize: 11,
              color: spell ? '#ddd' : '#777',
              textAlign: 'center',
              lineHeight: 1.1,
              padding: '0 4px',
            }}>
              {spell ? spell.name : 'Empty'}
            </div>

            {/* CD text */}
            {cdSec > 0 && (
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: 14,
                fontWeight: 'bold',
                color: '#fff',
                textShadow: '0 1px 3px #000',
                zIndex: 2,
              }}>
                {cdSec.toFixed(1)}
              </div>
            )}

            {/* Slot number */}
            <div style={{
              position: 'absolute',
              top: 3,
              left: 5,
              fontSize: 11,
              color: '#888',
            }}>
              {i + 1}
            </div>

            {/* Spell type icon */}
            {spell && (
              <SpellTypeIcon
                kind={spell.type}
                size={13}
                color="#999"
                style={{ position: 'absolute', top: 4, right: 5 }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
