import { useGameStore } from '../../stores/gameStore';
import { useNetworkStore } from '../../stores/networkStore';
import { Crosshair } from './Crosshair';
import { HealthBar } from './HealthBar';
import { SpellBar } from './SpellBar';
import { KillFeed } from './KillFeed';

export function HUD() {
  const { local, phase } = useGameStore();
  const { rtt } = useNetworkStore();

  if (phase !== 'playing') return null;

  return (
    <>
      <Crosshair />
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

      {/* Skill points indicator */}
      {local.skillPoints > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 110,
          right: 20,
          background: 'rgba(255,200,0,0.15)',
          border: '1px solid rgba(255,200,0,0.4)',
          borderRadius: 3,
          padding: '4px 10px',
          fontSize: 13,
          color: '#ffcc00',
          letterSpacing: 1,
          pointerEvents: 'none',
          zIndex: 100,
        }}>
          {local.skillPoints} skill {local.skillPoints === 1 ? 'point' : 'points'} — press Tab
        </div>
      )}

      {/* Death overlay */}
      {!local.isAlive && (
        <div style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.65)',
          zIndex: 200,
          flexDirection: 'column',
          gap: 16,
        }}>
          <div style={{ fontSize: 32, color: '#cc0000', letterSpacing: 6 }}>DEFEATED</div>
          <div style={{ fontSize: 15, color: '#999', letterSpacing: 2 }}>Respawning...</div>
        </div>
      )}
    </>
  );
}
