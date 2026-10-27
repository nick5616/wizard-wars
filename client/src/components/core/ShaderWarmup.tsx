/**
 * Precompiles every spell/effect shader program while the player is still in
 * the menus, so the first cast / spawn of anything doesn't stall the frame.
 *
 * Why: three.js compiles a material's program lazily, synchronously, the first
 * time it is drawn. A Crystalmancer shard (MeshPhysicalMaterial with clearcoat
 * + flat shading) or a Sword blade is a 30-100ms compile on a mid GPU -- right
 * in the middle of the fight, on the very frame the spell appears. Programs
 * are keyed on material *type + feature flags + light/fog setup* rather than
 * on colour, so compiling one representative of each variant used by
 * components/spells/* and the player models covers every instance later.
 *
 * How (ported from the portfolio's WorldWarmup): a throw-away group holding
 * one mesh per variant is added to the live scene (so the programs are built
 * against the REAL light set, including the pooled lights -- see LightPool)
 * and `gl.compileAsync` queues them for the GPU process to build in parallel
 * (KHR_parallel_shader_compile) without blocking the main thread. A second
 * pass repeats that with FogExp2 set, because Domain Expansion toggles
 * scene.fog and fog is part of every program key. The group is removed and
 * disposed afterwards; the compiled programs stay cached on the renderer.
 *
 * Re-runs when the light pool size changes (quality tier switch), since light
 * count is also part of the key.
 */

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useQualityStore, QUALITY_PRESETS } from '../../stores/qualityStore';
import { crystalShine } from '../../utils/crystalMaterial';

const AIRBUD_URL = '/audio/models/airbud.glb';

/** One mesh per distinct program variant used by spells and player models. */
function buildWarmGroup(): THREE.Group {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);

  const mats: THREE.Material[] = [
    // Projectile cores, glow shells, trails, telegraphs, rings, beams
    new THREE.MeshBasicMaterial({ color: '#fff' }),
    new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.2, side: THREE.BackSide }),
    new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.2, depthTest: false }),
    // Player body / arm / hat / barriers / amaterasu flames
    new THREE.MeshStandardMaterial({ color: '#888', emissive: '#888', emissiveIntensity: 0.1 }),
    new THREE.MeshStandardMaterial({ color: '#888', transparent: true, opacity: 0.5 }),
    // Melee shards
    new THREE.MeshStandardMaterial({ color: '#888', flatShading: true, emissive: '#888' }),
    // Sword blades (projectile, shard bursts, buff shards)
    new THREE.MeshPhysicalMaterial({
      color: '#ccc', flatShading: true, roughness: 0.1, metalness: 0.9,
      clearcoat: 1, clearcoatRoughness: 0.05, ior: 2.0, reflectivity: 1,
    }),
    new THREE.MeshPhysicalMaterial({
      color: '#ccc', flatShading: true, roughness: 0.1, metalness: 0.9,
      clearcoat: 1, clearcoatRoughness: 0.05, ior: 2.0, reflectivity: 1, transparent: true, opacity: 0.5,
    }),
    // Crystalmancer gems, shards, crystal wall
    new THREE.MeshPhysicalMaterial({ ...crystalShine('#8fd4ff') }),
  ];
  for (const m of mats) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  // Lightning / hitscan / chain / burst lines
  for (const transparent of [false, true]) {
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#fff', transparent, opacity: 0.5 }));
    line.frustumCulled = false;
    group.add(line);
  }
  return group;
}

function disposeGroup(group: THREE.Object3D) {
  const geos = new Set<THREE.BufferGeometry>();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) geos.add(mesh.geometry);
    const m = mesh.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else if (m) m.dispose();
  });
  geos.forEach((g) => g.dispose());
}

// Warmups are queued one at a time: overlapping runs (a quality-tier change
// while the first is still compiling) would fight over scene.fog and over
// materials another run is about to dispose.
let queue: Promise<void> = Promise.resolve();

async function compileWith(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, group: THREE.Object3D) {
  scene.add(group);
  const prevFog = scene.fog;
  try {
    await gl.compileAsync(scene, camera);
    // Domain Expansion swaps in FogExp2; fog is part of every program key.
    // (Skipped if a real domain fog is already up: its programs exist then.)
    if (!prevFog) {
      scene.fog = new THREE.FogExp2('#000000', 0.01);
      await gl.compileAsync(scene, camera);
    }
  } catch {
    // A material that can't precompile will just compile on first use instead.
  } finally {
    // Only undo our own temporary fog -- a domain may have replaced it meanwhile.
    if (!prevFog && scene.fog && scene.fog.color.getHex() === 0 && (scene.fog as THREE.FogExp2).density === 0.01) scene.fog = null;
    scene.remove(group);
  }
}

export function ShaderWarmup() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const lightCount = useQualityStore((s) => QUALITY_PRESETS[s.tier].maxLights);

  useEffect(() => {
    let cancelled = false;
    queue = queue.then(async () => {
      // Let the arena, pooled lights and first frame's React work settle so
      // the programs are built against the real light set.
      await new Promise((r) => setTimeout(r, 400));
      if (cancelled) return;
      const group = buildWarmGroup();
      await compileWith(gl, scene, camera, group);
      disposeGroup(group);
      if (cancelled) return;

      // Airbud's GLB (14MB, preloaded at startup by AirbudSpell) has its own
      // materials; parse it once here so its first summon isn't a stall.
      try {
        const gltf = await new GLTFLoader().loadAsync(AIRBUD_URL);
        if (cancelled) return;
        gltf.scene.traverse((o) => { o.frustumCulled = false; });
        await compileWith(gl, scene, camera, gltf.scene);
        disposeGroup(gltf.scene);
      } catch {
        // missing/undecodable model: nothing to warm
      }
    });
    return () => { cancelled = true; };
  }, [gl, scene, camera, lightCount]);

  return null;
}
