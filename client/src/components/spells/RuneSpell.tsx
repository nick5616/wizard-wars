/**
 * Ground-placed rune trap: a glowing rotating sigil (shape varies by school)
 * sitting inside a faint ring showing its trigger radius while armed, then a
 * quick elemental-colored burst the instant it's stepped on and detonates
 * (see SpellSystem._castRune / the rune branch in tickEffects).
 */

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EffectState } from '../../types/game.types';
import { getSpell } from 'shared/spells';
import { buildJaggedSegment } from '../../utils/jaggedLine';
import { createBladeGeometry } from '../../utils/bladeGeometry';

const SIDES_BY_SCHOOL: Record<string, number> = { fire: 3, ice: 6, dark: 5, sword: 4, druid: 5, crystalmancer: 8 };
const BURST_COUNT = 7;
const BURST_MS = 400;
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const FORWARD_AXIS = new THREE.Vector3(0, 0, 1);

function polygonPositions(sides: number, radius: number): Float32Array {
  const pts: number[] = [];
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  }
  return new Float32Array(pts);
}

export function RuneSpell({ effect }: { effect: EffectState }) {
  const triggeredAtRef = useRef<number | null>(null);
  const burstBuiltRef = useRef(false);
  const shardMeshRefs = useRef<(THREE.Mesh | null)[]>([]);

  if (!effect.position) return null;

  const spell = getSpell(effect.spellId);
  const color = spell?.color ?? effect.color ?? '#ffffff';
  const glow = spell?.glowColor ?? effect.glowColor ?? color;
  const radius = effect.radius ?? 2;
  const school = spell?.school ?? 'fire';
  const sides = SIDES_BY_SCHOOL[school] ?? 5;
  const triggered = !!effect.triggered;
  const isSword = school === 'sword';

  const scene = useMemo(() => {
    const sigilGeo = new THREE.BufferGeometry();
    sigilGeo.setAttribute('position', new THREE.BufferAttribute(polygonPositions(sides, radius * 0.55), 3));
    const sigilMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
    const sigilLine = new THREE.Line(sigilGeo, sigilMat);

    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });

    const burstMat = new THREE.LineBasicMaterial({ color: glow, transparent: true, opacity: 0 });
    const burstGeos: THREE.BufferGeometry[] = [];
    const burstLines: THREE.Line[] = [];
    for (let i = 0; i < (isSword ? 0 : BURST_COUNT); i++) {
      const geo = new THREE.BufferGeometry();
      burstGeos.push(geo);
      burstLines.push(new THREE.Line(geo, burstMat));
    }

    return { sigilGeo, sigilMat, sigilLine, ringMat, burstMat, burstGeos, burstLines };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect.id, color, glow, sides, radius, isSword]);

  // Sword rune detonations throw shiny blade shards instead of jagged spark
  // lines -- same treatment as AoeSpell's sword burst, see that file for why.
  const shardScene = useMemo(() => {
    if (!isSword) return null;
    const mat = new THREE.MeshPhysicalMaterial({
      color, flatShading: true, roughness: 0.1, metalness: 0.9,
      clearcoat: 1, clearcoatRoughness: 0.05, ior: 2.0, reflectivity: 1,
      transparent: true, opacity: 0,
    });
    const geometry = createBladeGeometry(radius * 0.3, radius * 0.2, radius * 0.08);
    const shards = Array.from({ length: BURST_COUNT }, () => ({
      end: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
    }));
    return { mat, geometry, shards };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect.id, isSword, color, radius]);

  useEffect(() => () => {
    scene.sigilGeo.dispose();
    scene.sigilMat.dispose();
    scene.ringMat.dispose();
    for (const g of scene.burstGeos) g.dispose();
    scene.burstMat.dispose();
    shardScene?.geometry.dispose();
    shardScene?.mat.dispose();
  }, [scene, shardScene]);

  useFrame(() => {
    const now = Date.now();

    scene.sigilLine.visible = !triggered;
    if (!triggered) {
      scene.sigilLine.rotation.z = now / 1400;
      const pulse = 0.85 + Math.sin(now / 260) * 0.15;
      scene.sigilLine.scale.setScalar(pulse);
      for (const l of scene.burstLines) l.visible = false;
      for (const m of shardMeshRefs.current) if (m) m.visible = false;
      return;
    }

    if (triggeredAtRef.current === null) triggeredAtRef.current = now;
    const sinceTrigger = now - triggeredAtRef.current;
    const inBurst = sinceTrigger < BURST_MS;

    if (inBurst && !burstBuiltRef.current) {
      burstBuiltRef.current = true;
      for (let i = 0; i < BURST_COUNT; i++) {
        const angle = (i / BURST_COUNT) * Math.PI * 2 + Math.random() * 0.5;
        const dist = radius * (0.4 + Math.random() * 0.8);
        const end = new THREE.Vector3(Math.cos(angle) * dist, 0.1 + Math.random() * 1.2, Math.sin(angle) * dist);
        if (shardScene) {
          shardScene.shards[i].end.copy(end);
          const dir = end.lengthSq() > 0.0001 ? end.clone().normalize() : FORWARD_AXIS;
          shardScene.shards[i].quat.setFromUnitVectors(UP_AXIS, dir);
        } else {
          const start = new THREE.Vector3(0, 0.1, 0);
          const positions = new Float32Array(buildJaggedSegment(start, end, 3, 0.4));
          scene.burstGeos[i].setAttribute('position', new THREE.BufferAttribute(positions, 3));
          scene.burstGeos[i].attributes.position.needsUpdate = true;
        }
      }
    }

    if (shardScene) {
      if (inBurst) {
        const p = Math.min(1, sinceTrigger / BURST_MS);
        const eased = 1 - (1 - p) * (1 - p);
        shardScene.mat.opacity = (1 - p) * 0.95;
        for (let i = 0; i < shardScene.shards.length; i++) {
          const mesh = shardMeshRefs.current[i];
          if (!mesh) continue;
          const { end, quat } = shardScene.shards[i];
          mesh.visible = true;
          mesh.position.set(end.x * eased, 0.15 + end.y * eased * 0.6, end.z * eased);
          mesh.quaternion.copy(quat);
        }
      } else {
        for (const m of shardMeshRefs.current) if (m) m.visible = false;
      }
    } else {
      const fade = Math.max(0, 1 - sinceTrigger / BURST_MS);
      scene.burstMat.opacity = inBurst ? fade * 0.9 : 0;
      for (const l of scene.burstLines) l.visible = inBurst;
    }
  });

  return (
    <group position={[effect.position.x, 0.05, effect.position.z]}>
      {!triggered && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} material={scene.ringMat}>
          <circleGeometry args={[radius, 40]} />
        </mesh>
      )}
      <primitive object={scene.sigilLine} />
      {shardScene
        ? shardScene.shards.map((_, i) => (
          <mesh
            key={i}
            ref={(el) => { shardMeshRefs.current[i] = el; }}
            geometry={shardScene.geometry}
            material={shardScene.mat}
            visible={false}
          />
        ))
        : scene.burstLines.map((line, i) => <primitive key={i} object={line} />)}
    </group>
  );
}
