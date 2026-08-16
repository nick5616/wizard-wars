import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EffectState } from '../../types/game.types';
import { BASIC_ATTACK } from 'shared/spells';
import { wandTipWorldPosition } from '../../utils/wandTip';

interface HitscanFlashProps {
  effect: EffectState;
}

const MAX_RANGE = 80;
const BASIC_ATTACK_IDS = new Set<string>(Object.values(BASIC_ATTACK));

export function HitscanFlash({ effect }: HitscanFlashProps) {
  const groupRef = useRef<THREE.Group>(null);

  const { origin, direction, color = '#ffffff', glowColor = '#ffffff', createdAt, expiresAt, spellId } = effect;
  // The weak always-on basic attack gets a dimmer glow line so it reads as
  // "minor" next to real spells -- it used to skip the glow line and cap
  // opacity at 0.6 entirely, which made a single-pixel WebGL line (the only
  // width LineBasicMaterial actually renders) functionally invisible in any
  // real fight, most notably Void Lash.
  const thin = spellId ? BASIC_ATTACK_IDS.has(spellId) : false;

  const { line1Obj, line2Obj } = useMemo(() => {
    if (!origin || !direction) return { line1Obj: null, line2Obj: null };
    // Draw from the wand tip, not the raw eye-level origin the server sent --
    // same fix as BeamSpell (see wandTip.ts). Direction's XZ angle stands in
    // for yaw here since this effect doesn't carry the owner's id/yaw itself.
    const yaw = Math.atan2(-direction.x, -direction.z);
    const wandOrigin = wandTipWorldPosition(origin, yaw);
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(wandOrigin.x, wandOrigin.y, wandOrigin.z),
      new THREE.Vector3(
        wandOrigin.x + direction.x * MAX_RANGE,
        wandOrigin.y + direction.y * MAX_RANGE,
        wandOrigin.z + direction.z * MAX_RANGE,
      ),
    ]);
    const mat1 = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    const mat2 = new THREE.LineBasicMaterial({ color: glowColor, transparent: true, opacity: thin ? 0.3 : 0.5 });
    return {
      line1Obj: new THREE.Line(geo, mat1),
      line2Obj: new THREE.Line(geo, mat2),
    };
  }, [origin?.x, origin?.y, origin?.z, direction?.x, direction?.y, direction?.z, color, glowColor, thin]);

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
    const peak = thin ? 0.85 : 1;
    groupRef.current.visible = life > 0;
    if (line1Obj) (line1Obj.material as THREE.LineBasicMaterial).opacity = life * peak;
    if (line2Obj) (line2Obj.material as THREE.LineBasicMaterial).opacity = life * (thin ? 0.3 : 0.5);
  });

  if (!line1Obj) return null;

  return (
    <group ref={groupRef}>
      <primitive object={line1Obj} />
      {line2Obj && <primitive object={line2Obj} />}
    </group>
  );
}
