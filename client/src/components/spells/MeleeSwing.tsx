import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EffectState } from '../../types/game.types';

interface MeleeSwingProps {
  effect: EffectState;
}

const SWING_RANGE = 2.2;

// Short-lived arc in front of the attacker -- same cheap-line approach as
// HitscanFlash, just curved and much shorter-range/shorter-lived to read as
// a punch rather than a beam.
export function MeleeSwing({ effect }: MeleeSwingProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { origin, direction, color = '#ffffff', createdAt, expiresAt } = effect;

  const lineObj = useMemo(() => {
    if (!origin || !direction) return null;
    const fwd = new THREE.Vector3(direction.x, 0, direction.z).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const center = new THREE.Vector3(origin.x, origin.y - 0.3, origin.z).addScaledVector(fwd, SWING_RANGE * 0.6);

    const points: THREE.Vector3[] = [];
    const ARC_SEGMENTS = 8;
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
      const t = (i / ARC_SEGMENTS - 0.5) * 1.4; // -0.7..0.7 radians sweep
      const p = center.clone()
        .addScaledVector(fwd, Math.cos(t) * 0.6)
        .addScaledVector(right, Math.sin(t) * 0.6);
      points.push(p);
    }

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    return new THREE.Line(geo, mat);
  }, [origin?.x, origin?.y, origin?.z, direction?.x, direction?.z, color]);

  useEffect(() => () => {
    lineObj?.geometry.dispose();
    (lineObj?.material as THREE.Material)?.dispose();
  }, [lineObj]);

  useFrame(() => {
    if (!groupRef.current) return;
    const now = Date.now();
    const total = expiresAt - createdAt;
    const life = total > 0 ? Math.max(0, (expiresAt - now) / total) : 0;
    groupRef.current.visible = life > 0;
    if (lineObj) (lineObj.material as THREE.LineBasicMaterial).opacity = life;
  });

  if (!lineObj) return null;

  return (
    <group ref={groupRef}>
      <primitive object={lineObj} />
    </group>
  );
}
