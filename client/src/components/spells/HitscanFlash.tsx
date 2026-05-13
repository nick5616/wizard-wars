import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EffectState } from '../../types/game.types';

interface HitscanFlashProps {
  effect: EffectState;
}

const MAX_RANGE = 80;

export function HitscanFlash({ effect }: HitscanFlashProps) {
  const groupRef = useRef<THREE.Group>(null);
  const line1 = useRef<THREE.Line>(null);
  const line2 = useRef<THREE.Line>(null);

  const { origin, direction, color = '#ffffff', glowColor = '#ffffff', createdAt, expiresAt } = effect;

  const { line1Obj, line2Obj } = useMemo(() => {
    if (!origin || !direction) return { line1Obj: null, line2Obj: null };
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(origin.x, origin.y, origin.z),
      new THREE.Vector3(
        origin.x + direction.x * MAX_RANGE,
        origin.y + direction.y * MAX_RANGE,
        origin.z + direction.z * MAX_RANGE,
      ),
    ]);
    const mat1 = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    const mat2 = new THREE.LineBasicMaterial({ color: glowColor, transparent: true, opacity: 0.5 });
    return {
      line1Obj: new THREE.Line(geo, mat1),
      line2Obj: new THREE.Line(geo, mat2),
    };
  }, [origin?.x, origin?.y, origin?.z, direction?.x, direction?.y, direction?.z, color, glowColor]);

  useEffect(() => () => {
    line1Obj?.geometry.dispose();
    (line1Obj?.material as THREE.Material)?.dispose();
    (line2Obj?.material as THREE.Material)?.dispose();
  }, [line1Obj, line2Obj]);

  useFrame(() => {
    if (!groupRef.current) return;
    const now = Date.now();
    const total = expiresAt - createdAt;
    const life = total > 0 ? Math.max(0, (expiresAt - now) / total) : 0;
    groupRef.current.visible = life > 0;
    if (line1Obj) (line1Obj.material as THREE.LineBasicMaterial).opacity = life;
    if (line2Obj) (line2Obj.material as THREE.LineBasicMaterial).opacity = life * 0.5;
  });

  if (!line1Obj || !line2Obj) return null;

  return (
    <group ref={groupRef}>
      <primitive object={line1Obj} />
      <primitive object={line2Obj} />
    </group>
  );
}
