import { useGameStore } from '../../stores/gameStore';

export function KillFeed() {
  const killFeed = useGameStore((s) => s.killFeed);

  return (
    <div style={{
      position: 'fixed',
      top: 60,
      right: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      pointerEvents: 'none',
      zIndex: 100,
    }}>
      {killFeed.slice(0, 5).map((entry, i) => {
        const age = Date.now() - entry.at;
        const opacity = Math.max(0, 1 - age / 5000);
        return (
          <div key={i} style={{
            background: 'rgba(0,0,0,0.6)',
            border: '1px solid #555',
            borderRadius: 3,
            padding: '4px 8px',
            fontSize: 12,
            opacity,
            display: 'flex',
            gap: 6,
            alignItems: 'center',
          }}>
            <span style={{ color: '#ff6666' }}>{entry.killerSymbol ? `${entry.killerSymbol} ` : ''}{entry.killer}</span>
            <span style={{ color: '#aaa' }}>→</span>
            <span style={{ color: '#ccc' }}>{entry.victimSymbol ? `${entry.victimSymbol} ` : ''}{entry.victim}</span>
          </div>
        );
      })}
    </div>
  );
}
