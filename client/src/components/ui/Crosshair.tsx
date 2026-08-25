import { useEffect, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { getSpell } from 'shared/spells';

const CLASS_COLORS: Record<string, string> = {
  fire: '#ff6b2b',
  ice: '#a0d8ff',
  dark: '#cc00ff',
  sword: '#e0e0e0',
  druid: '#5a9e3d',
  crystalmancer: '#8fd4ff',
};

const RING_RADIUS = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Fills in around the crosshair over a windup spell's charge time -- see
 * CameraController's cast block for where this gets set. Pure CSS animation
 * (keyed by startedAt so a new cast restarts it cleanly) rather than a
 * per-frame JS tick, since it's just a fixed-duration fill. */
function ChargeRing({ color, windupMs, startedAt }: { color: string; windupMs: number; startedAt: number }) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDone(false);
    const t = setTimeout(() => setDone(true), windupMs);
    return () => clearTimeout(t);
  }, [startedAt, windupMs]);

  if (done) return null;

  return (
    <svg width={RING_RADIUS * 2 + 8} height={RING_RADIUS * 2 + 8} style={{
      position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-90deg)',
    }}>
      <style>{`
        @keyframes ww-charge-ring-fill { from { stroke-dashoffset: ${RING_CIRCUMFERENCE}; } to { stroke-dashoffset: 0; } }
      `}</style>
      <circle
        key={startedAt}
        cx={RING_RADIUS + 4} cy={RING_RADIUS + 4} r={RING_RADIUS}
        fill="none" stroke={color} strokeWidth={2} strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        style={{ animation: `ww-charge-ring-fill ${windupMs}ms linear forwards`, filter: `drop-shadow(0 0 3px ${color})` }}
      />
    </svg>
  );
}

export function Crosshair() {
  const { local } = useGameStore();
  const chargingSpell = useGameStore((s) => s.chargingSpell);
  const moveCurveDeg = useGameStore((s) => s.local.moveCurveDeg);
  const color = CLASS_COLORS[local.class ?? ''] ?? '#ffffff';
  const chargeColor = chargingSpell ? getSpell(chargingSpell.spellId)?.glowColor ?? color : color;

  // Learnable-tech readout for the movement-curve mechanic (see
  // SpellSystem._castProjectile): a shot fired right now would bend by this
  // many degrees, in this direction -- so strafing to intentionally curve a
  // shot, or holding still/compensating to avoid it, is something you can
  // see happening rather than a hidden number.
  const curveClamped = Math.max(-14, Math.min(14, moveCurveDeg));
  const curveTickOffset = curveClamped * 1.1; // px of horizontal drift at max curve

  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
      zIndex: 100,
    }}>
      {chargingSpell && (
        <ChargeRing color={chargeColor} windupMs={chargingSpell.windupMs} startedAt={chargingSpell.startedAt} />
      )}
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
      {/* Movement-curve indicator: drifts sideways with your current strafe
          curve. Centered = a shot fired now flies straight. */}
      {Math.abs(curveClamped) > 0.3 && (
        <div style={{
          position: 'absolute',
          top: '-22px',
          left: `calc(50% + ${curveTickOffset}px)`,
          width: 3,
          height: 3,
          borderRadius: '50%',
          background: color,
          opacity: Math.min(1, Math.abs(curveClamped) / 14) * 0.9,
          transform: 'translateX(-50%)',
          boxShadow: `0 0 3px ${color}`,
        }} />
      )}
    </div>
  );
}
