import { useGameStore } from '../../stores/gameStore';
import { Crosshair } from './Crosshair';
import { StatusWells } from './StatusWells';
import { SpellBar } from './SpellBar';
import { KillFeed } from './KillFeed';
import { CombatLogHUD } from './CombatLog';
import { DomainBanner } from './DomainBanner';
import { NetworkStats } from './NetworkStats';
import type { WebSocketClient } from '../../networking/WebSocketClient';

export function HUD({ ws }: { ws: WebSocketClient }) {
  const { local, phase } = useGameStore();

  if (phase !== 'playing') return null;

  return (
    <>
      <Crosshair />
      <StatusWells />
      <SpellBar />
      <KillFeed />
      <CombatLogHUD ws={ws} />
      <DomainBanner />
      <NetworkStats />

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
      </div>

      {/* Fire Solar Flare: brief blind flash when hit by a caster with the passive */}
      <BlindFlash />
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
