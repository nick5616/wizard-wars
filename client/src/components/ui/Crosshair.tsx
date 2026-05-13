import { useGameStore } from '../../stores/gameStore';

const CLASS_COLORS: Record<string, string> = {
  fire: '#ff6b2b',
  ice: '#a0d8ff',
  dark: '#cc00ff',
  sword: '#e0e0e0',
  earth: '#c8a040',
};

export function Crosshair() {
  const { local } = useGameStore();
  const color = CLASS_COLORS[local.class ?? ''] ?? '#ffffff';

  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
      zIndex: 100,
    }}>
      {/* Dot */}
      <div style={{
        width: 4,
        height: 4,
        background: color,
        borderRadius: '50%',
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        boxShadow: `0 0 4px ${color}`,
      }} />
      {/* Arms */}
      {[
        { top: '-14px', left: '50%', width: 1, height: 10, transform: 'translateX(-50%)' },
        { bottom: '-14px', left: '50%', width: 1, height: 10, transform: 'translateX(-50%)' },
        { left: '-14px', top: '50%', width: 10, height: 1, transform: 'translateY(-50%)' },
        { right: '-14px', top: '50%', width: 10, height: 1, transform: 'translateY(-50%)' },
      ].map((style, i) => (
        <div key={i} style={{
          ...style,
          position: 'absolute',
          background: color,
          opacity: 0.8,
        }} />
      ))}
    </div>
  );
}
