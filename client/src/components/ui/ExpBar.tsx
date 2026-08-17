import { useGameStore } from '../../stores/gameStore';
import { xpProgress } from 'shared/leveling';

// Sits just above the health bar. Same slim-bar treatment, blue instead of
// health's red/green/yellow so it doesn't get confused for HP at a glance.
export function ExpBar() {
  const local = useGameStore((s) => s.local);
  const { level, intoLevel, needed, fraction } = xpProgress(local.xp);

  return (
    <div style={{
      position: 'fixed',
      bottom: 174, // clears the taller card-style SpellBar (see SpellCard.tsx)
      left: '50%',
      transform: 'translateX(-50%)',
      width: 280,
      pointerEvents: 'none',
      zIndex: 100,
    }}>
      <div style={{
        fontSize: 10,
        color: '#88aaff',
        letterSpacing: 2,
        marginBottom: 3,
        textAlign: 'center',
        textTransform: 'uppercase',
      }}>
        Level {level} — {intoLevel} / {needed} XP
      </div>
      <div style={{
        width: '100%',
        height: 5,
        background: '#111',
        border: '1px solid #444',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.max(0, Math.min(1, fraction)) * 100}%`,
          height: '100%',
          background: '#66aaff',
          transition: 'width 0.2s ease',
          boxShadow: '0 0 5px #66aaff',
        }} />
      </div>
    </div>
  );
}
