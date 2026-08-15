/**
 * Earth's Tremor Sense passive: a faint pulsing ring at nearby enemies' feet,
 * visible even through walls (there's no line-of-sight/occlusion system in
 * this game at all — every player's exact position is already broadcast to
 * everyone every tick — so this is a UI-only "you'd notice them nearby" cue
 * gated on the passive, not a new vision/fog-of-war system).
 */

import { useMemo } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { useNetworkStore } from '../../stores/networkStore';

const RANGE = 20;

export function TremorSense() {
  const hasTremorSense = useGameStore((s) => s.local.unlockedNodes.includes('tremor_sense'));
  const players = useGameStore((s) => s.players);
  const localPos = useGameStore((s) => s.local.position);
  const { localPlayerId } = useNetworkStore();

  const nearby = useMemo(() => {
    if (!hasTremorSense) return [];
    return Object.values(players).filter((p) => {
      if (p.id === localPlayerId || !p.isAlive) return false;
      const dx = p.position.x - localPos.x, dz = p.position.z - localPos.z;
      return Math.sqrt(dx * dx + dz * dz) < RANGE;
    });
  }, [hasTremorSense, players, localPos, localPlayerId]);

  if (nearby.length === 0) return null;

  return (
    <>
      {nearby.map((p) => (
        <mesh key={p.id} position={[p.position.x, 0.05, p.position.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.5, 0.7, 24]} />
          <meshBasicMaterial color="#8B6914" transparent opacity={0.5} depthTest={false} />
        </mesh>
      ))}
    </>
  );
}
