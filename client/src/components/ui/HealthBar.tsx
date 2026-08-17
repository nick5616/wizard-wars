import { useGameStore } from '../../stores/gameStore';

export function HealthBar() {
  const { local } = useGameStore();
  const pct = Math.max(0, local.health / local.maxHealth);

  const barColor = pct > 0.6 ? '#44ff88'
    : pct > 0.3 ? '#ffcc00'
    : '#ff3333';

  return (
    <div style={{
      position: 'fixed',
      bottom: 142, // clears the taller card-style SpellBar (see SpellCard.tsx)
      left: '50%',
      transform: 'translateX(-50%)',
      width: 280,
      pointerEvents: 'none',
      zIndex: 100,
    }}>
      <div style={{
        fontSize: 13,
        color: '#ccc',
        letterSpacing: 2,
        marginBottom: 4,
        textAlign: 'center',
        textTransform: 'uppercase',
      }}>
        {Math.ceil(local.health)} / {local.maxHealth}
      </div>
      <div style={{
        width: '100%',
        height: 8,
        background: '#111',
        border: '1px solid #555',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct * 100}%`,
          height: '100%',
          background: barColor,
          transition: 'width 0.1s ease, background 0.3s',
          boxShadow: `0 0 6px ${barColor}`,
        }} />
      </div>
    </div>
  );
}
