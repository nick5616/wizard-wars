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

const SIDES_BY_SCHOOL: Record<string, number> = { fire: 3, ice: 6, dark: 5, sword: 4, earth: 8 };
const BURST_COUNT = 7;
const BURST_MS = 400;

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

  if (!effect.position) return null;

  const spell = getSpell(effect.spellId);
  const color = spell?.color ?? effect.color ?? '#ffffff';
  const glow = spell?.glowColor ?? effect.glowColor ?? color;
  const radius = effect.radius ?? 2;
  const sides = SIDES_BY_SCHOOL[spell?.school ?? 'fire'] ?? 5;
  const triggered = !!effect.triggered;

  const scene = useMemo(() => {
    const sigilGeo = new THREE.BufferGeometry();
    sigilGeo.setAttribute('position', new THREE.BufferAttribute(polygonPositions(sides, radius * 0.55), 3));
    const sigilMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
    const sigilLine = new THREE.Line(sigilGeo, sigilMat);

    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });

    const burstMat = new THREE.LineBasicMaterial({ color: glow, transparent: true, opacity: 0 });
    const burstGeos: THREE.BufferGeometry[] = [];
    const burstLines: THREE.Line[] = [];
    for (let i = 0; i < BURST_COUNT; i++) {
      const geo = new THREE.BufferGeometry();
      burstGeos.push(geo);
      burstLines.push(new THREE.Line(geo, burstMat));
    }

    return { sigilGeo, sigilMat, sigilLine, ringMat, burstMat, burstGeos, burstLines };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect.id, color, glow, sides, radius]);

  useEffect(() => () => {
    scene.sigilGeo.dispose();
    scene.sigilMat.dispose();
    scene.ringMat.dispose();
    for (const g of scene.burstGeos) g.dispose();
    scene.burstMat.dispose();
  }, [scene]);

  useFrame(() => {
    const now = Date.now();

    scene.sigilLine.visible = !triggered;
    if (!triggered) {
      scene.sigilLine.rotation.z = now / 1400;
      const pulse = 0.85 + Math.sin(now / 260) * 0.15;
      scene.sigilLine.scale.setScalar(pulse);
      for (const l of scene.burstLines) l.visible = false;
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
        const start = new THREE.Vector3(0, 0.1, 0);
        const end = new THREE.Vector3(Math.cos(angle) * dist, 0.1 + Math.random() * 1.2, Math.sin(angle) * dist);
        const positions = new Float32Array(buildJaggedSegment(start, end, 3, 0.4));
        scene.burstGeos[i].setAttribute('position', new THREE.BufferAttribute(positions, 3));
        scene.burstGeos[i].attributes.position.needsUpdate = true;
      }
    }

    const fade = Math.max(0, 1 - sinceTrigger / BURST_MS);
    scene.burstMat.opacity = inBurst ? fade * 0.9 : 0;
    for (const l of scene.burstLines) l.visible = inBurst;
  });

  return (
    <group position={[effect.position.x, 0.05, effect.position.z]}>
      {!triggered && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} material={scene.ringMat}>
          <circleGeometry args={[radius, 40]} />
        </mesh>
      )}
      <primitive object={scene.sigilLine} />
      {scene.burstLines.map((line, i) => <primitive key={i} object={line} />)}
    </group>
  );
}
