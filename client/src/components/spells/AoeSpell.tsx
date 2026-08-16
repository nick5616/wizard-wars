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

type School = 'fire' | 'ice' | 'dark' | 'sword' | 'earth';

interface BurstSpec { count: number; jitter: number; segments: number; spread: number; heightBias: number; ringSegments: number; }

// Per-school impact-burst character: fire flings sparse jagged embers upward,
// ice fires straight sharp shards (also gives its ring a hexagonal/crystal
// facet count instead of a smooth circle), dark's particles curl and swirl
// (high segment count, high jitter), sword throws clean straight slash
// lines, earth flings chunky short jagged debris.
const BURST_SPEC: Record<School, BurstSpec> = {
  fire:  { count: 9, jitter: 0.45, segments: 3, spread: 1.1, heightBias: 1.6, ringSegments: 40 },
  ice:   { count: 8, jitter: 0.04, segments: 1, spread: 1.0, heightBias: 0.7, ringSegments: 6 },
  dark:  { count: 6, jitter: 0.55, segments: 4, spread: 0.85, heightBias: 0.4, ringSegments: 40 },
  sword: { count: 6, jitter: 0.02, segments: 1, spread: 1.25, heightBias: 0.25, ringSegments: 40 },
  earth: { count: 7, jitter: 0.35, segments: 2, spread: 0.8, heightBias: 1.1, ringSegments: 9 },
};

const BURST_MS = 420;

export function AoeSpell({ effect }: { effect: EffectState }) {
  const telegraphRef = useRef<THREE.Mesh>(null);
  const fillRef = useRef<THREE.Mesh>(null);
  const burstBuiltRef = useRef(false);

  if (!effect.position) return null;

  const spell = getSpell(effect.spellId);
  const school = (spell?.school as School) ?? 'fire';
  const spec = BURST_SPEC[school] ?? BURST_SPEC.fire;
  const color = spell?.color ?? effect.color ?? '#ffffff';
  const glow = spell?.glowColor ?? effect.glowColor ?? color;
  const radius = effect.radius ?? 2;
  const isLine = effect.shape === 'line' && !!effect.direction && !!effect.length;
  const activatesAt = effect.activatesAt ?? effect.startedAt ?? Date.now();
  const startedAt = effect.startedAt ?? activatesAt;
  const lingers = (effect.duration ?? 0) > 0;

  const rotY = isLine && effect.direction ? Math.atan2(effect.direction.x, effect.direction.z) : 0;
  const centerX = isLine && effect.direction && effect.length
    ? effect.position.x + effect.direction.x * effect.length * 0.5
    : effect.position.x;
  const centerZ = isLine && effect.direction && effect.length
    ? effect.position.z + effect.direction.z * effect.length * 0.5
    : effect.position.z;

  const burstScene = useMemo(() => {
    const mat = new THREE.LineBasicMaterial({ color: glow, transparent: true, opacity: 0 });
    const geos: THREE.BufferGeometry[] = [];
    const lines: THREE.Line[] = [];
    for (let i = 0; i < spec.count; i++) {
      const geo = new THREE.BufferGeometry();
      geos.push(geo);
      lines.push(new THREE.Line(geo, mat));
    }
    return { mat, geos, lines };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect.id, glow, spec.count]);

  useEffect(() => () => {
    for (const g of burstScene.geos) g.dispose();
    burstScene.mat.dispose();
  }, [burstScene]);

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
        const start = new THREE.Vector3(0, 0.1, 0);
        const end = new THREE.Vector3(
          Math.cos(angle) * dist,
          0.1 + Math.random() * spec.heightBias,
          Math.sin(angle) * dist,
        );
        const positions = new Float32Array(buildJaggedSegment(start, end, spec.segments, spec.jitter));
        burstScene.geos[i].setAttribute('position', new THREE.BufferAttribute(positions, 3));
        burstScene.geos[i].attributes.position.needsUpdate = true;
      }
    }
    if (inBurst) {
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

      {/* Elemental burst particles */}
      {burstScene.lines.map((line, i) => <primitive key={i} object={line} />)}
    </group>
  );
}
