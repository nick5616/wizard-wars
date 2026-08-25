/**
 * Visualizes 'aoe' effects (Frost Nova, Immolate, Fissure, Blood Nova, etc.)
 * — every school gets its own telegraph texture and impact burst instead of
 * one generic ring+disc for everything (Lightning Strike gets an even more
 * bespoke version of this treatment, see LightningStrikeSpell.tsx). Three
 * phases: telegraph ring (windup), impact burst (instant pop+fade, with a
 * handful of elemental-flavored particle lines flying out), and a lingering
 * translucent zone for effects with a duration (e.g. Blizzard, Immolate).
 * Line-shaped effects (Fissure) render as a stretched box instead of a disc.
 */

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EffectState } from '../../types/game.types';
import { getSpell } from 'shared/spells';
import { buildJaggedSegment } from '../../utils/jaggedLine';
import { createBladeGeometry } from '../../utils/bladeGeometry';

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const FORWARD_AXIS = new THREE.Vector3(0, 0, 1);

type School = 'fire' | 'ice' | 'dark' | 'sword' | 'druid' | 'crystalmancer';

interface BurstSpec { count: number; jitter: number; segments: number; spread: number; heightBias: number; ringSegments: number; }

// Per-school impact-burst character: fire flings sparse jagged embers upward,
// ice fires straight sharp shards (also gives its ring a hexagonal/crystal
// facet count instead of a smooth circle), dark's particles curl and swirl
// (high segment count, high jitter), sword throws clean straight slash
// lines, druid flings soft irregular bramble/leaf debris, crystalmancer
// throws sharp faceted shrapnel.
const BURST_SPEC: Record<School, BurstSpec> = {
  fire:  { count: 9, jitter: 0.45, segments: 3, spread: 1.1, heightBias: 1.6, ringSegments: 40 },
  ice:   { count: 8, jitter: 0.04, segments: 1, spread: 1.0, heightBias: 0.7, ringSegments: 6 },
  dark:  { count: 6, jitter: 0.55, segments: 4, spread: 0.85, heightBias: 0.4, ringSegments: 40 },
  sword: { count: 6, jitter: 0.02, segments: 1, spread: 1.25, heightBias: 0.25, ringSegments: 40 },
  druid: { count: 8, jitter: 0.5, segments: 2, spread: 0.9, heightBias: 0.9, ringSegments: 7 },
  crystalmancer: { count: 7, jitter: 0.08, segments: 2, spread: 1.0, heightBias: 1.0, ringSegments: 8 },
};

const BURST_MS = 420;

export function AoeSpell({ effect }: { effect: EffectState }) {
  const telegraphRef = useRef<THREE.Mesh>(null);
  const fillRef = useRef<THREE.Mesh>(null);
  const burstBuiltRef = useRef(false);
  const shardMeshRefs = useRef<(THREE.Mesh | null)[]>([]);

  if (!effect.position) return null;

  const spell = getSpell(effect.spellId);
  // Not every aoe effect is a real cast spell -- passive-triggered ones
  // (domain stone spires, dash trails, frost trails, ...) use a synthetic
  // spellId that getSpell() doesn't know, so they carry their own
  // school/color directly on the effect instead (see SpellSystem.js).
  const school = (spell?.school as School) ?? (effect.school as School) ?? 'fire';
  const spec = BURST_SPEC[school] ?? BURST_SPEC.fire;
  const color = spell?.color ?? effect.color ?? '#ffffff';
  const glow = spell?.glowColor ?? effect.glowColor ?? color;
  const radius = effect.radius ?? 2;
  const isLine = effect.shape === 'line' && !!effect.direction && !!effect.length;
  const activatesAt = effect.activatesAt ?? effect.startedAt ?? Date.now();
  const startedAt = effect.startedAt ?? activatesAt;
  const lingers = (effect.duration ?? 0) > 0;
  const isSword = school === 'sword';

  const rotY = isLine && effect.direction ? Math.atan2(effect.direction.x, effect.direction.z) : 0;
  const centerX = isLine && effect.direction && effect.length
    ? effect.position.x + effect.direction.x * effect.length * 0.5
    : effect.position.x;
  const centerZ = isLine && effect.direction && effect.length
    ? effect.position.z + effect.direction.z * effect.length * 0.5
    : effect.position.z;

  // Sword impact bursts are real metal, not particle sparks -- a handful of
  // small blade-shard meshes that fly outward from the impact and catch the
  // scene's actual lights, instead of thin (and near-invisible) 1px WebGL
  // lines. Every other school keeps the jagged-line burst below.
  const burstScene = useMemo(() => {
    const mat = new THREE.LineBasicMaterial({ color: glow, transparent: true, opacity: 0 });
    const geos: THREE.BufferGeometry[] = [];
    const lines: THREE.Line[] = [];
    for (let i = 0; i < (isSword ? 0 : spec.count); i++) {
      const geo = new THREE.BufferGeometry();
      geos.push(geo);
      lines.push(new THREE.Line(geo, mat));
    }
    return { mat, geos, lines };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect.id, glow, spec.count, isSword]);

  const shardScene = useMemo(() => {
    if (!isSword) return null;
    const mat = new THREE.MeshPhysicalMaterial({
      color, flatShading: true, roughness: 0.1, metalness: 0.9,
      clearcoat: 1, clearcoatRoughness: 0.05, ior: 2.0, reflectivity: 1,
      transparent: true, opacity: 0,
    });
    const geometry = createBladeGeometry(radius * 0.34, radius * 0.24, radius * 0.09);
    const shards = Array.from({ length: spec.count }, () => ({
      end: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
    }));
    return { mat, geometry, shards };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect.id, isSword, color, spec.count, radius]);

  useEffect(() => () => {
    for (const g of burstScene.geos) g.dispose();
    burstScene.mat.dispose();
    shardScene?.geometry.dispose();
    shardScene?.mat.dispose();
  }, [burstScene, shardScene]);

  useFrame(() => {
    const now = Date.now();
    const telegraphing = now < activatesAt;

    if (telegraphRef.current) {
      const mat = telegraphRef.current.material as THREE.MeshBasicMaterial;
      if (telegraphing) {
        const span = Math.max(1, activatesAt - startedAt);
        const t = Math.min(1, (now - startedAt) / span);
        telegraphRef.current.visible = true;
        telegraphRef.current.scale.setScalar(0.15 + t * 0.85);
        // Per-school flicker character on the telegraph itself.
        const flicker = school === 'fire' ? Math.abs(Math.sin(now / 55)) * 0.3
          : school === 'sword' ? 0
          : school === 'dark' ? Math.sin(now / 140) * 0.2
          : Math.sin(now / 220) * 0.15;
        mat.opacity = 0.25 + flicker + t * 0.2;
      } else {
        telegraphRef.current.visible = false;
      }
    }

    if (fillRef.current) {
      const mat = fillRef.current.material as THREE.MeshBasicMaterial;
      if (telegraphing) {
        fillRef.current.visible = false;
      } else {
        fillRef.current.visible = true;
        const sinceActivate = now - activatesAt;
        if (lingers) {
          // Persistent zone: gentle pulse for its whole duration.
          const pulse = 0.85 + Math.sin(now / 220) * 0.15;
          fillRef.current.scale.setScalar(pulse);
          mat.opacity = 0.28;
        } else {
          // One-shot burst: quick pop then fade over ~450ms.
          const burstLife = Math.min(1, sinceActivate / 450);
          fillRef.current.scale.setScalar(1 + burstLife * 0.5);
          mat.opacity = Math.max(0, 0.55 * (1 - burstLife));
        }
      }
    }

    // Elemental burst particles, fired once right at impact.
    const sinceActivate = now - activatesAt;
    const inBurst = !telegraphing && sinceActivate < BURST_MS;
    if (inBurst && !burstBuiltRef.current) {
      burstBuiltRef.current = true;
      for (let i = 0; i < spec.count; i++) {
        const angle = (i / spec.count) * Math.PI * 2 + Math.random() * 0.6;
        const dist = radius * (0.3 + Math.random() * 0.7) * spec.spread;
        const end = new THREE.Vector3(
          Math.cos(angle) * dist,
          0.1 + Math.random() * spec.heightBias,
          Math.sin(angle) * dist,
        );
        if (shardScene) {
          shardScene.shards[i].end.copy(end);
          const dir = end.lengthSq() > 0.0001 ? end.clone().normalize() : FORWARD_AXIS;
          shardScene.shards[i].quat.setFromUnitVectors(UP_AXIS, dir);
        } else {
          const start = new THREE.Vector3(0, 0.1, 0);
          const positions = new Float32Array(buildJaggedSegment(start, end, spec.segments, spec.jitter));
          burstScene.geos[i].setAttribute('position', new THREE.BufferAttribute(positions, 3));
          burstScene.geos[i].attributes.position.needsUpdate = true;
        }
      }
    }

    if (shardScene) {
      if (inBurst) {
        const p = Math.min(1, sinceActivate / BURST_MS);
        const eased = 1 - (1 - p) * (1 - p); // ease-out: quick launch, settles near the end
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
    } else if (inBurst) {
      const fade = Math.max(0, 1 - sinceActivate / BURST_MS);
      burstScene.mat.opacity = fade * 0.8;
      for (const l of burstScene.lines) l.visible = true;
    } else {
      for (const l of burstScene.lines) l.visible = false;
    }
  });

  return (
    <group position={[centerX, 0.06, centerZ]} rotation={[0, rotY, 0]}>
      {/* Telegraph: expanding ring/outline during windup */}
      <mesh ref={telegraphRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        {isLine
          ? <planeGeometry args={[radius * 2, effect.length ?? 1]} />
          : <ringGeometry args={[Math.max(0.05, radius - 0.25), radius, spec.ringSegments]} />}
        <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* Fill: impact burst or lingering zone */}
      <mesh ref={fillRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        {isLine
          ? <planeGeometry args={[radius * 2, effect.length ?? 1]} />
          : <circleGeometry args={[radius, 40]} />}
        <meshBasicMaterial color={glow} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* Elemental burst particles -- shiny blade shards for sword, jagged lines everywhere else */}
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
        : burstScene.lines.map((line, i) => <primitive key={i} object={line} />)}
    </group>
  );
}
