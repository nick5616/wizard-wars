import { useGameStore } from '../../stores/gameStore';
import { useNetworkStore } from '../../stores/networkStore';
import { Crosshair } from './Crosshair';
import { HealthBar } from './HealthBar';
import { ExpBar } from './ExpBar';
import { SpellBar } from './SpellBar';
import { KillFeed } from './KillFeed';

export function HUD() {
  const { local, phase } = useGameStore();
  const { rtt } = useNetworkStore();

  if (phase !== 'playing') return null;

  return (
    <>
      <Crosshair />
      <ExpBar />
      <HealthBar />
      <SpellBar />
      <KillFeed />

      {/* Kill count */}
      <div style={{
        position: 'fixed',
        top: 12,
        left: 12,
        fontSize: 14,
        color: '#bbb',
        pointerEvents: 'none',
        zIndex: 100,
        letterSpacing: 1,
      }}>
        <div>K {local.kills}</div>
        <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>{rtt}ms</div>
      </div>

      {/* Fire Solar Flare: brief blind flash when hit by a caster with the passive */}
      <BlindFlash />

      {/* Class badge */}
      {local.class && (
        <div style={{
          position: 'fixed',
          top: 12,
          right: 12,
          fontSize: 13,
          color: '#aaa',
          textTransform: 'uppercase',
          letterSpacing: 3,
          pointerEvents: 'none',
          zIndex: 100,
        }}>
          {local.class}
        </div>
      )}

    </>
  );
}

const BLIND_DURATION_MS = 500;

function BlindFlash() {
  const blind = useGameStore((s) => s.local.activeEffects.blind);
  if (!blind) return null;

  const remaining = blind.expiresAt - Date.now();
  if (remaining <= 0) return null;
  const opacity = Math.min(0.85, (remaining / BLIND_DURATION_MS) * 0.85);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#fff',
      opacity,
      pointerEvents: 'none',
      zIndex: 250,
      transition: 'opacity 80ms linear',
    }} />
  );
}
