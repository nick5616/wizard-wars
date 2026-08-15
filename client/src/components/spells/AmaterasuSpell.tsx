/**
 * Persistent black-fire visual for an active Amaterasu dot — a scatter of
 * low-poly black flame "licks" (4-sided cones, so they read as jagged
 * triangles rather than smooth fire) spread all the way around the target's
 * body, each flickering independently, rather than one blob at the torso.
 * Each flame sits in its own outer group rotated only around Y (so it faces
 * radially outward at its position on the ring) with the cone tilted only
 * around that group's local X axis -- kept as two separate rotations rather
 * than one combined Euler so the outward lean is correct at every angle
 * instead of collapsing toward whichever way the combined rotation happens
 * to face (previously made them read as clustered on one side).
 * Tracks the live target position each frame since the effect itself
 * carries no position, just a targetId.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../stores/gameStore';
import type { EffectState } from '../../types/game.types';

const FLAME_COUNT = 18;
const BODY_RADIUS = 0.55; // just outside PLAYER_CAPSULE_RADIUS (0.4) so flames aren't clipped inside the model

interface FlameSpec {
  angle: number; y: number;
  tilt: number; baseScale: number; phase: number;
}

export function AmaterasuSpell({ effect }: { effect: EffectState }) {
  const groupRef = useRef<THREE.Group>(null);
  const flameRefs = useRef<(THREE.Mesh | null)[]>([]);

  const flames = useMemo<FlameSpec[]>(() => {
    const specs: FlameSpec[] = [];
    // Two interleaved rings (golden-angle spacing) so flames cover the full
    // 360° around the body at multiple heights, not just one band.
    for (let i = 0; i < FLAME_COUNT; i++) {
      const angle = i * 2.4; // golden-angle-ish spread, avoids visible banding
      const heightT = (i * 0.53) % 1;
      specs.push({
        angle,
        y: -1.55 + heightT * 1.55,
        tilt: 0.35 + ((i * 13) % 7) / 16,
        baseScale: 0.6 + ((i * 17) % 9) / 11,
        phase: i * 0.87,
      });
    }
    return specs;
  }, []);

  useFrame(() => {
    if (!effect.targetId) return;
    const target = useGameStore.getState().players[effect.targetId];
    if (!target || !groupRef.current) return;

    groupRef.current.position.set(target.position.x, target.position.y, target.position.z);
    groupRef.current.visible = target.isAlive;

    const now = Date.now();
    for (let i = 0; i < flameRefs.current.length; i++) {
      const mesh = flameRefs.current[i];
      if (!mesh) continue;
      const spec = flames[i];
      const flicker = 0.55 + Math.sin(now / 90 + spec.phase) * 0.3 + Math.sin(now / 47 + spec.phase * 1.7) * 0.15;
      mesh.scale.set(spec.baseScale, spec.baseScale * Math.max(0.15, flicker), spec.baseScale);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.35 + flicker * 0.35;
    }
  });

  return (
    <group ref={groupRef}>
      {flames.map((spec, i) => (
        <group key={i} rotation={[0, spec.angle, 0]}>
          <mesh
            ref={(el) => { flameRefs.current[i] = el; }}
            position={[0, spec.y, BODY_RADIUS]}
            rotation={[Math.PI + spec.tilt, 0, 0]}
          >
            <coneGeometry args={[0.13, 0.4, 4]} />
            <meshStandardMaterial
              color="#000000"
              emissive="#1a0008"
              emissiveIntensity={0.5}
              roughness={0.5}
              transparent
              opacity={0.95}
            />
          </mesh>
        </group>
      ))}
      <pointLight color="#ff0022" intensity={1.1} distance={4.5} decay={2} />
    </group>
  );
}
