import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EffectState } from '../../types/game.types';
import { getSpell } from 'shared/spells';
import { createBladeGeometry } from '../../utils/bladeGeometry';

interface MeleeSwingProps {
  effect: EffectState;
}

const SWING_RANGE = 2.2;
const ARC_SEGMENTS = 8;
const SHARD_COUNT = 5;
const UP_AXIS = new THREE.Vector3(0, 1, 0);

// Short-lived arc in front of the attacker. Sword's Pommel Strike gets a fan
// of small shiny blade shards frozen along the swing path -- everyone else's
// punch keeps the plain flash line (a fist doesn't need to look like metal).
export function MeleeSwing({ effect }: MeleeSwingProps) {
  const groupRef = useRef<THREE.Group>(null);
  const shardMeshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const { origin, direction, color = '#ffffff', createdAt, expiresAt, spellId } = effect;
  const isSword = spellId ? getSpell(spellId)?.class === 'sword' : false;

  const arc = useMemo(() => {
    if (!origin || !direction) return null;
    const fwd = new THREE.Vector3(direction.x, 0, direction.z).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const center = new THREE.Vector3(origin.x, origin.y - 0.3, origin.z).addScaledVector(fwd, SWING_RANGE * 0.6);

    const points: THREE.Vector3[] = [];
    const tangents: THREE.Vector3[] = [];
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
      const t = (i / ARC_SEGMENTS - 0.5) * 1.4; // -0.7..0.7 radians sweep
      points.push(center.clone().addScaledVector(fwd, Math.cos(t) * 0.6).addScaledVector(right, Math.sin(t) * 0.6));
      // d/dt of the arc parametrization -- the blade's swing direction at this point.
      tangents.push(fwd.clone().multiplyScalar(-Math.sin(t)).addScaledVector(right, Math.cos(t)).normalize());
    }
    return { points, tangents };
  }, [origin?.x, origin?.y, origin?.z, direction?.x, direction?.z]);

  const lineObj = useMemo(() => {
    if (isSword || !arc) return null;
    const geo = new THREE.BufferGeometry().setFromPoints(arc.points);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    return new THREE.Line(geo, mat);
  }, [isSword, arc, color]);

  const shardScene = useMemo(() => {
    if (!isSword || !arc) return null;
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 1.4,
      flatShading: true, roughness: 0.2, metalness: 0.75,
    });
    const geometry = createBladeGeometry(0.55, 0.32, 0.1);
    return { mat, geometry };
  }, [isSword, arc, color]);

  useEffect(() => () => {
    lineObj?.geometry.dispose();
    (lineObj?.material as THREE.Material)?.dispose();
    shardScene?.geometry.dispose();
    shardScene?.mat.dispose();
  }, [lineObj, shardScene]);

  useFrame(() => {
    if (!groupRef.current) return;
    const now = Date.now();
    const total = expiresAt - createdAt;
    const life = total > 0 ? Math.max(0, (expiresAt - now) / total) : 0;
    groupRef.current.visible = life > 0;

    if (lineObj) (lineObj.material as THREE.LineBasicMaterial).opacity = life;

    if (shardScene && arc) {
      shardScene.mat.emissiveIntensity = life * 1.4;
      const step = Math.max(1, Math.floor(arc.points.length / SHARD_COUNT));
      for (let i = 0; i < SHARD_COUNT; i++) {
        const mesh = shardMeshRefs.current[i];
        if (!mesh) continue;
        const idx = Math.min(arc.points.length - 1, i * step);
        mesh.position.copy(arc.points[idx]);
        mesh.quaternion.setFromUnitVectors(UP_AXIS, arc.tangents[idx]);
        const pop = 0.7 + (1 - life) * 0.3; // quick pop outward as it fades
        mesh.scale.setScalar(pop);
      }
    }
  });

  if (!lineObj && !shardScene) return null;

  return (
    <group ref={groupRef}>
      {lineObj && <primitive object={lineObj} />}
      {shardScene && Array.from({ length: SHARD_COUNT }).map((_, i) => (
        <mesh
          key={i}
          ref={(el) => { shardMeshRefs.current[i] = el; }}
          geometry={shardScene.geometry}
          material={shardScene.mat}
        />
      ))}
    </group>
  );
}
