/**
 * Gem Plop's landing decoy -- a spinning, glinting rupee dropped on the
 * ground with zero gameplay effect (see SpellSystem._spawnGemDecoy: no
 * damage, no trigger, no pickup). Purely bait: it just needs to be the
 * brightest, most eye-catching thing on the ground for a few seconds, then
 * fade out gracefully rather than pop when it expires.
 *
 * This is the literal rupee, material recipe and all -- see crystalMaterial.ts
 * for the "shine" recipe every other Crystalmancer visual now shares (this is
 * its origin piece). flatShading gives every facet its own hard specular
 * point instead of one smooth highlight: that's the actual sparkle. High
 * metalness + very low roughness makes those points small and mirror-bright
 * instead of a soft diffuse blob. The clearcoat adds a second independent
 * highlight layer on top, like a polished coating over the metal, which is
 * what reads as "glassy" rather than "metallic." None of it is physically a
 * gem -- it's a dozen triangles -- but each trick targets one specific cue
 * the eye uses to recognize "gem" on sight, and stacked together they're
 * convincing for a fraction of the cost of real dispersion/refraction.
 */

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EffectState } from '../../types/game.types';
import { createRupeeGeometry } from '../../utils/rupeeGeometry';
import { crystalShine } from '../../utils/crystalMaterial';

interface GemPlopSpellProps {
  effect: EffectState;
}

const BOB_SPEED = 0.6;
const BOB_HEIGHT = 0.18;
const SPIN_SPEED = 2.2;
const FADE_MS = 500;
const RUPEE_HEIGHT = 0.85;

export function GemPlopSpell({ effect }: GemPlopSpellProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  const baseX = effect.position?.x ?? 0;
  const baseY = (effect.position?.y ?? 0) + RUPEE_HEIGHT * 0.45;
  const baseZ = effect.position?.z ?? 0;
  const color = effect.color ?? '#39ff6a';
  const glowColor = effect.glowColor ?? '#baffd9';

  const scene = useMemo(() => {
    const geometry = createRupeeGeometry(0.4, RUPEE_HEIGHT);
    const glowGeo = new THREE.SphereGeometry(0.55, 10, 10);
    const glowMat = new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.18, side: THREE.BackSide });
    return { geometry, glowGeo, glowMat };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glowColor]);

  useEffect(() => () => {
    scene.geometry.dispose();
    scene.glowGeo.dispose();
    scene.glowMat.dispose();
  }, [scene]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const time = state.clock.getElapsedTime();

    meshRef.current.rotation.y += SPIN_SPEED * 0.016;

    const bobPhase = time * BOB_SPEED + baseX * 3 + baseZ * 3;
    const y = baseY + ((Math.sin(bobPhase) + 1) / 2) * BOB_HEIGHT;
    meshRef.current.position.set(baseX, y, baseZ);
    if (glowRef.current) glowRef.current.position.set(baseX, y, baseZ);
    if (lightRef.current) lightRef.current.position.set(baseX, y, baseZ);

    // Fade out over the last moment instead of popping when it expires.
    const remaining = effect.expiresAt - Date.now();
    const scale = Math.max(0, Math.min(1, remaining / FADE_MS));
    meshRef.current.scale.setScalar(scale);
    if (glowRef.current) glowRef.current.scale.setScalar(scale);
    if (lightRef.current) lightRef.current.intensity = 10 * scale;
  });

  return (
    <>
      <mesh ref={meshRef} geometry={scene.geometry} position={[baseX, baseY, baseZ]} renderOrder={999}>
        <meshPhysicalMaterial {...crystalShine(color)} />
      </mesh>
      <mesh ref={glowRef} geometry={scene.glowGeo} material={scene.glowMat} position={[baseX, baseY, baseZ]} />
      <pointLight ref={lightRef} position={[baseX, baseY, baseZ]} color={glowColor} intensity={10} distance={10} decay={2} />
    </>
  );
}
