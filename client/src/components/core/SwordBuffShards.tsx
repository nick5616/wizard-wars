/**
 * Sword-only buff indicators, attached directly to the wizard's own body
 * (so they move with the player for free -- no separate world-space effect
 * or position tracking needed). Parry and Phantom Blade set player-state
 * flags/counters server-side with no visual of their own (see
 * SpellSystem._castDirect); this is that missing feedback.
 */

import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createBladeGeometry } from '../../utils/bladeGeometry';

interface SwordBuffShardsProps {
  color: string;
  parryActive: boolean;
  phantomCasts: number;
}

const MAX_PHANTOM = 3;
const ORBIT_RADIUS = 0.55;
const ORBIT_HEIGHT = 1.55;
const ORBIT_SPEED = 1.6;

const SHINY_MATERIAL_PROPS = {
  flatShading: true, roughness: 0.1, metalness: 0.9,
  clearcoat: 1, clearcoatRoughness: 0.05, ior: 2, reflectivity: 1,
};

export function SwordBuffShards({ color, parryActive, phantomCasts }: SwordBuffShardsProps) {
  const guardRef = useRef<THREE.Mesh>(null);
  const orbitRefs = useRef<(THREE.Mesh | null)[]>([]);

  const guardGeometry = useMemo(() => createBladeGeometry(0.5, 0.3, 0.09), []);
  const orbitGeometry = useMemo(() => createBladeGeometry(0.32, 0.2, 0.07), []);

  useEffect(() => () => {
    guardGeometry.dispose();
    orbitGeometry.dispose();
  }, [guardGeometry, orbitGeometry]);

  useFrame((state) => {
    if (guardRef.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 10) * 0.08;
      guardRef.current.scale.setScalar(parryActive ? pulse : 0);
    }
    for (let i = 0; i < MAX_PHANTOM; i++) {
      const mesh = orbitRefs.current[i];
      if (!mesh) continue;
      if (i >= phantomCasts) { mesh.scale.setScalar(0); continue; }
      mesh.scale.setScalar(1);
      // Phantom Blade literally orbits you -- one blade per mirrored cast
      // still charged, so the count visibly drains as they're consumed.
      const angle = state.clock.elapsedTime * ORBIT_SPEED + (i / MAX_PHANTOM) * Math.PI * 2;
      mesh.position.set(Math.cos(angle) * ORBIT_RADIUS, ORBIT_HEIGHT + Math.sin(angle * 2) * 0.08, Math.sin(angle) * ORBIT_RADIUS);
      mesh.rotation.y = -angle;
    }
  });

  return (
    <>
      {/* Parry: a raised guard shard, held up for the block window */}
      <mesh ref={guardRef} position={[0.32, 1.3, -0.4]} rotation={[0.3, 0.5, 0.9]} geometry={guardGeometry} scale={0}>
        <meshPhysicalMaterial color={color} {...SHINY_MATERIAL_PROPS} />
      </mesh>

      {/* Phantom Blade: one orbiting shard per charge remaining */}
      {Array.from({ length: MAX_PHANTOM }).map((_, i) => (
        <mesh key={i} ref={(el) => { orbitRefs.current[i] = el; }} geometry={orbitGeometry} scale={0}>
          <meshPhysicalMaterial color={color} {...SHINY_MATERIAL_PROPS} />
        </mesh>
      ))}
    </>
  );
}
