import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getSpell } from 'shared/spells';
import type { EffectState } from '../../types/game.types';
import { useGameStore } from '../../stores/gameStore';

interface BeamSpellProps {
  effect: EffectState;
}

export function BeamSpell({ effect }: BeamSpellProps) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  const spell = getSpell(effect.spellId);
  const color = spell?.color ?? '#ffffff';
  const glowColor = spell?.glowColor ?? '#ffffff';

  const players = useGameStore((s) => s.players);
  const owner = players[effect.ownerId];
  if (!owner) return null;

  const origin = owner.position;
  const dir = effect.direction;
  if (!dir) return null;

  const BEAM_LENGTH = 20;

  useFrame(() => {
    if (!matRef.current) return;
    const now = Date.now();
    const remaining = effect.expiresAt - now;
    const t = remaining > 0 ? 1 : 0;
    matRef.current.opacity = t * 0.85;
    if (meshRef.current) meshRef.current.visible = t > 0;

    // Pulse effect
    if (meshRef.current && t > 0) {
      const pulse = 1 + Math.sin(now * 0.01) * 0.15;
      meshRef.current.scale.setScalar(pulse);
    }
  });

  // Orient cylinder from origin toward dir
  const mid = new THREE.Vector3(
    origin.x + dir.x * BEAM_LENGTH / 2,
    (origin.y + 0.8) + dir.y * BEAM_LENGTH / 2,
    origin.z + dir.z * BEAM_LENGTH / 2,
  );

  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const beamDir = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
  quat.setFromUnitVectors(up, beamDir);

  return (
    <mesh ref={meshRef} position={[mid.x, mid.y, mid.z]} quaternion={quat}>
      <cylinderGeometry args={[0.08, 0.08, BEAM_LENGTH, 8]} />
      <meshBasicMaterial ref={matRef} color={color} transparent opacity={0.85} />
    </mesh>
  );
}
