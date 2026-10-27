/**
 * Fixed pool of point lights shared by every spell/effect.
 *
 * Why: three.js bakes the NUMBER of lights into every lit material's shader
 * program. A <pointLight> mounted per projectile / gem / status effect meant
 * each cast or expiry changed the count, so every MeshStandard/Physical
 * material in view (arena, players, walls) recompiled its shader on the spot
 * -- a 50-200ms hitch on the first cast of anything and a steady stutter in
 * busy fights. Here the pool is mounted once with a constant size
 * (QUALITY_PRESETS[tier].maxLights); an effect borrows a light, drives its
 * position/colour/intensity imperatively, and hands it back, which just parks
 * it at intensity 0. The light never leaves the scene (`visible` stays true
 * too -- three only counts visible lights), so the program key is stable.
 *
 * When the pool is empty `acquireLight()` returns null and the effect simply
 * renders without a light -- its emissive/basic materials carry the look.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useQualityStore, QUALITY_PRESETS } from '../../stores/qualityStore';

const all = new Set<THREE.PointLight>();
let free: THREE.PointLight[] = [];

export interface LightOpts {
  color: THREE.ColorRepresentation;
  distance: number;
  intensity: number;
  position?: { x: number; y: number; z: number };
}

/** Borrow a light, or null if the pool is exhausted. */
export function acquireLight(opts: LightOpts): THREE.PointLight | null {
  const light = free.pop();
  if (!light) return null;
  light.color.set(opts.color);
  light.distance = opts.distance;
  light.intensity = opts.intensity;
  if (opts.position) light.position.set(opts.position.x, opts.position.y, opts.position.z);
  return light;
}

export function releaseLight(light: THREE.PointLight | null) {
  if (!light || !all.has(light)) return;
  light.intensity = 0;
  if (!free.includes(light)) free.push(light);
}

/**
 * Borrow a pooled light for the lifetime of the calling component. `ref.current`
 * is null if none was free; callers drive it from useFrame. `opts` is only read
 * when the borrow happens (colour / distance / starting intensity / starting position).
 */
export function usePooledLight(opts: LightOpts, enabled = true): React.MutableRefObject<THREE.PointLight | null> {
  const ref = useRef<THREE.PointLight | null>(null);
  useEffect(() => {
    if (!enabled) return;
    ref.current = acquireLight(opts);
    return () => {
      releaseLight(ref.current);
      ref.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return ref;
}

/** Mounted once inside the Canvas. Renders the pool at the current tier's size. */
export function LightPool() {
  const count = useQualityStore((s) => QUALITY_PRESETS[s.tier].maxLights);
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <PooledLight key={i} />
      ))}
    </>
  );
}

function PooledLight() {
  const ref = useRef<THREE.PointLight>(null);
  useEffect(() => {
    const light = ref.current;
    if (!light) return;
    all.add(light);
    free.push(light);
    return () => {
      all.delete(light);
      free = free.filter((l) => l !== light);
    };
  }, []);
  // decay 2 matches every light it replaces; intensity 0 = parked.
  return <pointLight ref={ref} intensity={0} distance={10} decay={2} />;
}
