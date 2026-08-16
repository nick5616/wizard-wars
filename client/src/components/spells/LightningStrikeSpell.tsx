/**
 * Lightning Strike's telegraph-through-impact sequence. Previously this spell
 * reused the fully generic AoeSpell (a plain expanding ring + burst disc) —
 * functional, but nothing about it read as "lightning". This version layers
 * in three lightning-specific beats on top of the same ground circle:
 *  1. Windup: a handful of thin, sparse, flickering yellow sparks around the
 *     ring — "the dielectric almost breaking down" — that intensify as the
 *     strike gets closer to landing.
 *  2. The instant it activates: a bright flash + several thick chaotic bolts
 *     converging on the impact point from above.
 *  3. A quick fading burst disc on the ground, same as other aoe impacts.
 */

import { useMemo, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EffectState } from '../../types/game.types';
import { getSpell } from 'shared/spells';
import { buildJaggedSegment } from '../../utils/jaggedLine';

const SPARK_COUNT = 6;
const SPARK_SEGMENTS = 3;
const BOLT_COUNT = 6;
const BOLT_SEGMENTS = 6;
const BURST_MS = 450;

export function LightningStrikeSpell({ effect }: { effect: EffectState }) {
  if (!effect.position) return null;

  const spell = getSpell(effect.spellId);
  const color = spell?.color ?? effect.color ?? '#ffe066';
  const glow = spell?.glowColor ?? effect.glowColor ?? '#ffffff';
  const radius = effect.radius ?? 2;
  const activatesAt = effect.activatesAt ?? effect.startedAt ?? Date.now();
  const startedAt = effect.startedAt ?? activatesAt;
  const center = effect.position;

  const scene = useMemo(() => {
    const telegraphMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const burstMat = new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const flashMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });

    const sparkLines: THREE.Line[] = [];
    const sparkGeos: THREE.BufferGeometry[] = [];
    const sparkMats: THREE.LineBasicMaterial[] = [];
    for (let i = 0; i < SPARK_COUNT; i++) {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
      sparkGeos.push(geo);
      sparkMats.push(mat);
      sparkLines.push(new THREE.Line(geo, mat));
    }

    const boltCoreLines: THREE.Line[] = [];
    const boltGlowLines: THREE.Line[] = [];
    const boltGeos: THREE.BufferGeometry[] = [];
    const boltCoreMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0 });
    const boltGlowMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
    for (let i = 0; i < BOLT_COUNT; i++) {
      const geo = new THREE.BufferGeometry();
      boltGeos.push(geo);
      boltCoreLines.push(new THREE.Line(geo, boltCoreMat));
      boltGlowLines.push(new THREE.Line(geo, boltGlowMat));
    }

    return {
      telegraphMat, burstMat, flashMat,
      sparkLines, sparkGeos, sparkMats,
      boltCoreLines, boltGlowLines, boltGeos, boltCoreMat, boltGlowMat,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect.id, color, glow]);

  useEffect(() => () => {
    scene.telegraphMat.dispose();
    scene.burstMat.dispose();
    scene.flashMat.dispose();
    for (const g of scene.sparkGeos) g.dispose();
    for (const m of scene.sparkMats) m.dispose();
    for (const g of scene.boltGeos) g.dispose();
    scene.boltCoreMat.dispose();
    scene.boltGlowMat.dispose();
  }, [scene]);

  const telegraphRef = useRef<THREE.Mesh>(null);
  const burstRef = useRef<THREE.Mesh>(null);
  const flashRef = useRef<THREE.Mesh>(null);
  const lastSparkJitterRef = useRef(0);
  const lastBoltJitterRef = useRef(0);
  const boltsBuiltRef = useRef(false);

  useFrame(() => {
    const now = Date.now();
    const telegraphing = now < activatesAt;
    const sinceActivate = now - activatesAt;

    // ── Telegraph ring ──────────────────────────────────────────────────
    if (telegraphRef.current) {
      const mat = telegraphRef.current.material as THREE.MeshBasicMaterial;
      if (telegraphing) {
        const span = Math.max(1, activatesAt - startedAt);
        const t = Math.min(1, (now - startedAt) / span);
        telegraphRef.current.visible = true;
        telegraphRef.current.scale.setScalar(0.15 + t * 0.85);
        // Flicker speeds up as the strike nears — the "breakdown" getting worse.
        const flickerHz = 20 + t * 70;
        mat.opacity = 0.2 + Math.abs(Math.sin(now / (1000 / flickerHz))) * 0.35 + t * 0.25;
      } else {
        telegraphRef.current.visible = false;
      }
    }

    // ── Sparse pre-strike sparks around the ring ────────────────────────
    const windupSpan = Math.max(1, activatesAt - startedAt);
    const windupT = Math.min(1, Math.max(0, (now - startedAt) / windupSpan));
    const sparkJitterInterval = telegraphing ? Math.max(35, 140 - windupT * 100) : 1e9;
    if (telegraphing && now - lastSparkJitterRef.current > sparkJitterInterval) {
      lastSparkJitterRef.current = now;
      // Only light up a growing fraction of the pool as windup progresses.
      const activeCount = Math.max(1, Math.round(SPARK_COUNT * (0.3 + windupT * 0.7)));
      for (let i = 0; i < SPARK_COUNT; i++) {
        const mat = scene.sparkMats[i];
        if (i >= activeCount || Math.random() > 0.7) {
          mat.opacity = 0;
          continue;
        }
        const angle = Math.random() * Math.PI * 2;
        const ringR = radius * (0.6 + Math.random() * 0.5);
        const a = new THREE.Vector3(center.x + Math.cos(angle) * ringR, 0.05, center.z + Math.sin(angle) * ringR);
        const inward = Math.random() * radius * 0.35;
        const b = new THREE.Vector3(
          center.x + Math.cos(angle) * (ringR - inward),
          0.05 + Math.random() * (0.6 + windupT * 1.2),
          center.z + Math.sin(angle) * (ringR - inward),
        );
        const positions = new Float32Array(buildJaggedSegment(a, b, SPARK_SEGMENTS, 0.25));
        scene.sparkGeos[i].setAttribute('position', new THREE.BufferAttribute(positions, 3));
        scene.sparkGeos[i].attributes.position.needsUpdate = true;
        mat.opacity = 0.35 + windupT * 0.5 + Math.random() * 0.15;
      }
    }
    for (const line of scene.sparkLines) line.visible = telegraphing;

    // ── Impact: chaotic converging bolts + flash ────────────────────────
    const inBurst = !telegraphing && sinceActivate < BURST_MS;
    if (inBurst && !boltsBuiltRef.current) {
      boltsBuiltRef.current = true;
      for (let i = 0; i < BOLT_COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * radius * 0.7;
        const top = new THREE.Vector3(
          center.x + Math.cos(angle) * radius * (0.5 + Math.random() * 0.8),
          6 + Math.random() * 4,
          center.z + Math.sin(angle) * radius * (0.5 + Math.random() * 0.8),
        );
        const bottom = new THREE.Vector3(center.x + Math.cos(angle) * dist, 0.05, center.z + Math.sin(angle) * dist);
        const positions = new Float32Array(buildJaggedSegment(top, bottom, BOLT_SEGMENTS, 0.9));
        scene.boltGeos[i].setAttribute('position', new THREE.BufferAttribute(positions, 3));
        scene.boltGeos[i].attributes.position.needsUpdate = true;
      }
    }
    if (!telegraphing) {
      // Re-crackle the bolts a couple more times through the burst for a chaotic flicker.
      if (inBurst && now - lastBoltJitterRef.current > 60) {
        lastBoltJitterRef.current = now;
        for (let i = 0; i < BOLT_COUNT; i++) {
          if (Math.random() > 0.5) continue; // not every bolt every tick
          const pos = scene.boltGeos[i].attributes.position as THREE.BufferAttribute;
          if (!pos) continue;
          const top = new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0));
          const bottom = new THREE.Vector3(pos.getX(pos.count - 1), pos.getY(pos.count - 1), pos.getZ(pos.count - 1));
          const positions = new Float32Array(buildJaggedSegment(top, bottom, BOLT_SEGMENTS, 0.9));
          scene.boltGeos[i].setAttribute('position', new THREE.BufferAttribute(positions, 3));
          scene.boltGeos[i].attributes.position.needsUpdate = true;
        }
      }
      const burstFade = Math.max(0, 1 - sinceActivate / BURST_MS);
      const boltOpacity = inBurst ? burstFade : 0;
      scene.boltCoreMat.opacity = boltOpacity;
      scene.boltGlowMat.opacity = boltOpacity * 0.6;
      for (const line of scene.boltCoreLines) line.visible = inBurst;
      for (const line of scene.boltGlowLines) line.visible = inBurst;
    } else {
      for (const line of scene.boltCoreLines) line.visible = false;
      for (const line of scene.boltGlowLines) line.visible = false;
      boltsBuiltRef.current = false;
    }

    // Bright instantaneous flash right at impact
    if (flashRef.current) {
      const mat = flashRef.current.material as THREE.MeshBasicMaterial;
      if (!telegraphing && sinceActivate < 180) {
        flashRef.current.visible = true;
        const t = sinceActivate / 180;
        mat.opacity = (1 - t) * 0.9;
        flashRef.current.scale.setScalar(0.6 + t * 1.8);
      } else {
        flashRef.current.visible = false;
      }
    }

    // Ground burst disc (fades in behind the flash)
    if (burstRef.current) {
      const mat = burstRef.current.material as THREE.MeshBasicMaterial;
      if (telegraphing) {
        burstRef.current.visible = false;
      } else {
        burstRef.current.visible = true;
        const burstLife = Math.min(1, sinceActivate / BURST_MS);
        burstRef.current.scale.setScalar(1 + burstLife * 0.6);
        mat.opacity = Math.max(0, 0.6 * (1 - burstLife));
      }
    }
  });

  return (
    <group position={[center.x, 0, center.z]}>
      <mesh ref={telegraphRef} rotation={[-Math.PI / 2, 0, 0]} visible={false} material={scene.telegraphMat}>
        <ringGeometry args={[Math.max(0.05, radius - 0.2), radius, 48]} />
      </mesh>

      <mesh ref={burstRef} rotation={[-Math.PI / 2, 0, 0]} visible={false} material={scene.burstMat}>
        <circleGeometry args={[radius, 48]} />
      </mesh>

      <mesh ref={flashRef} rotation={[-Math.PI / 2, 0, 0]} visible={false} material={scene.flashMat}>
        <circleGeometry args={[radius * 0.7, 32]} />
      </mesh>

      {scene.sparkLines.map((line, i) => <primitive key={`spark-${i}`} object={line} />)}
      {scene.boltGlowLines.map((line, i) => <primitive key={`bolt-glow-${i}`} object={line} />)}
      {scene.boltCoreLines.map((line, i) => <primitive key={`bolt-core-${i}`} object={line} />)}
    </group>
  );
}
