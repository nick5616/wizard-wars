/**
 * Renders active spell-cast barriers (Ice Wall, Rock Wall) as a translucent
 * slab. Position/width/height come straight from server state — no local
 * physics needed here, collision is handled in ClientPrediction/Room.
 */

import type { BarrierState } from '../../types/game.types';
import { crystalShine } from '../../utils/crystalMaterial';

const BARRIER_LOOK: Record<string, { color: string; glow: string; opacity: number }> = {
  ice_wall: { color: '#a0d8ff', glow: '#c8f0ff', opacity: 0.55 },
  rock_wall: { color: '#6B5010', glow: '#8B6914', opacity: 0.85 },
  crystal_wall: { color: '#6fb8e0', glow: '#8fd4ff', opacity: 0.7 },
};

export function BarrierRenderer({ barrier }: { barrier: BarrierState }) {
  const look = BARRIER_LOOK[barrier.spellId] ?? { color: '#888888', glow: '#aaaaaa', opacity: 0.7 };
  const healthFrac = barrier.health != null && barrier.health > 0
    ? Math.max(0.15, Math.min(1, barrier.health / 240))
    : 1;

  // Crystal Wall is a faceted crystalline column, not a smooth pillar --
  // 6 radial segments + flatShading read as a hexagonal crystal, using the
  // same "shine" material every other Crystalmancer visual shares (see
  // crystalMaterial.ts) instead of the plain matte rock/ice look.
  if (barrier.spellId === 'crystal_wall') {
    return (
      <mesh position={[barrier.position.x, barrier.position.y, barrier.position.z]} castShadow receiveShadow>
        <cylinderGeometry args={[barrier.width / 2, barrier.width / 2, barrier.height, 6]} />
        <meshPhysicalMaterial
          {...crystalShine(look.color, look.opacity * healthFrac + 0.1)}
          emissiveIntensity={0.4 * healthFrac}
        />
      </mesh>
    );
  }

  return (
    <mesh position={[barrier.position.x, barrier.position.y, barrier.position.z]} castShadow receiveShadow>
      <cylinderGeometry args={[barrier.width / 2, barrier.width / 2, barrier.height, 12]} />
      <meshStandardMaterial
        color={look.color}
        emissive={look.glow}
        emissiveIntensity={0.4 * healthFrac}
        transparent
        opacity={look.opacity * healthFrac + 0.1}
        roughness={0.6}
      />
    </mesh>
  );
}
