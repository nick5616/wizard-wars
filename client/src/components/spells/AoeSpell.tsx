/**
 * Visualizes 'aoe' effects (Lightning Strike, Frost Nova, Immolate, Fissure,
 * etc.) — previously these had NO client-side visual at all, so damage was
 * dealt server-side but the player saw nothing happen. Three phases:
 * telegraph ring (windup), impact burst (instant pop+fade), and a lingering
 * translucent zone for effects with a duration (e.g. Blizzard, Immolate).
 * Line-shaped effects (Fissure) render as a stretched box instead of a disc.
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EffectState } from '../../types/game.types';
import { getSpell } from 'shared/spells';

export function AoeSpell({ effect }: { effect: EffectState }) {
  const telegraphRef = useRef<THREE.Mesh>(null);
  const fillRef = useRef<THREE.Mesh>(null);

  if (!effect.position) return null;

  const spell = getSpell(effect.spellId);
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
        mat.opacity = 0.25 + Math.sin(now / 60) * 0.15 + t * 0.2;
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
  });

  return (
    <group position={[centerX, 0.06, centerZ]} rotation={[0, rotY, 0]}>
      {/* Telegraph: expanding ring/outline during windup */}
      <mesh ref={telegraphRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        {isLine
          ? <planeGeometry args={[radius * 2, effect.length ?? 1]} />
          : <ringGeometry args={[Math.max(0.05, radius - 0.25), radius, 40]} />}
        <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* Fill: impact burst or lingering zone */}
      <mesh ref={fillRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        {isLine
          ? <planeGeometry args={[radius * 2, effect.length ?? 1]} />
          : <circleGeometry args={[radius, 40]} />}
        <meshBasicMaterial color={glow} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
