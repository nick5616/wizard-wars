/**
 * Druid Airbud summon: renders the airbud model hopping along the arc the
 * server picked (see SpellSystem._castAirbud / _tickAirbud).
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { EffectState } from '../../types/game.types';

const MODEL_URL = '/audio/models/airbud.glb';
const TARGET_HEIGHT = 1.4;
const HOP_HEIGHT = 2.2;

type AirbudEffect = EffectState & {
  hopFrom?: { x: number; y: number; z: number };
  hopTo?: { x: number; y: number; z: number };
  hopStart?: number;
  hopEnd?: number;
  yaw?: number;
};

export function AirbudSpell({ effect }: { effect: EffectState }) {
  const e = effect as AirbudEffect;
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(MODEL_URL);

  const model = useMemo(() => {
    const clone = scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const s = size.y > 0 ? TARGET_HEIGHT / size.y : 1;
    clone.scale.setScalar(s);
    clone.position.y = -box.min.y * s;
    return clone;
  }, [scene]);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const from = e.hopFrom ?? e.position;
    const to = e.hopTo ?? e.position;
    if (!from || !to) return;

    const now = Date.now();
    const start = e.hopStart ?? now;
    const end = e.hopEnd ?? now;
    const t = end > start ? THREE.MathUtils.clamp((now - start) / (end - start), 0, 1) : 1;

    g.position.set(
      THREE.MathUtils.lerp(from.x, to.x, t),
      Math.sin(t * Math.PI) * HOP_HEIGHT,
      THREE.MathUtils.lerp(from.z, to.z, t),
    );
    g.rotation.y = e.yaw ?? 0;

    // Squash on the ground, stretch in the air, and a dopey idle wobble
    const airborne = t > 0 && t < 1;
    const squash = airborne ? 1.1 : 0.9 + Math.sin(now / 120) * 0.05;
    g.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    g.rotation.z = airborne ? 0 : Math.sin(now / 300) * 0.15;
  });

  return (
    <group ref={groupRef}>
      <primitive object={model} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);
