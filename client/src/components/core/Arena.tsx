import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useGameStore } from '../../stores/gameStore';
import { ARENA_RADIUS, ARENA_WALL_HEIGHT } from 'shared/constants';
import { TERRAIN_PIECES } from 'shared/mapLayout';
import { pbr, scaleUV, worldBox } from '../../utils/pbrMaterial';

/**
 * Arena visuals. Everything here is purely cosmetic: the server collides
 * against shared/mapLayout.js (TERRAIN_PIECES + terrainHeightAt), and every
 * mesh below is generated straight from that data so the two can't drift.
 *
 * Render budget (was ~31 draw calls: 8 point lights, 8 separate pillar/flame
 * meshes, one mesh per terrain piece and ring):
 *   floor, wall, rings, terrain (all pieces merged), pillars (instanced),
 *   flames (instanced), torch light pools (instanced)  = 7 draws, 2 of them
 *   shadow casters, and zero point lights. The torches' glow is a baked
 *   additive light-pool decal under each one instead of a pointLight, which
 *   forced every lit material to loop over 8 extra lights.
 *
 * `quality`: 'low' = no normal maps and no shadows (cheapest);
 * 'medium' = normal maps + 1024 shadow map; 'high' (default) = 2048 shadow
 * map + 8x anisotropy.
 */
export type ArenaQuality = 'low' | 'medium' | 'high';

const FLOOR_SEGMENTS = 128;
const WALL_SEGMENTS  = 128;
const PILLAR_COUNT   = 8;
const PILLAR_HEIGHT  = 5;
const TILE = 4; // metres of world per texture repeat
const FLOOR_TINT = '#b4b8dc';

// Cheap generated IBL (no download, works offline): a tiny PMREM of three's
// RoomEnvironment, built once per renderer and kept for the page's lifetime.
const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();
function getEnv(gl: THREE.WebGLRenderer): THREE.Texture {
  let t = envCache.get(gl);
  if (!t) {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    t = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    envCache.set(gl, t);
  }
  return t;
}

// Soft radial glow used for the torch light pools.
function makeGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function Arena({ quality = 'high' }: { quality?: ArenaQuality }) {
  const domains = useGameStore((s) => s.domains);
  const gl = useThree((s) => s.gl);

  const activeDomain = useMemo(() => {
    for (const d of Object.values(domains)) {
      if (d.active && Date.now() < d.expiresAt) return d;
    }
    return null;
  }, [domains]);

  const domainColor = useMemo(() => {
    if (!activeDomain) return null;
    const colorMap: Record<string, string> = {
      inferno_domain: '#ff4400',
      absolute_zero:  '#88ccff',
      event_horizon:  '#220044',
      the_last_word:  '#888888',
      terra_domain:   '#553300',
    };
    return colorMap[activeDomain.spellId] ?? null;
  }, [activeDomain]);

  const hasNormal = quality !== 'low';
  const anisotropy = quality === 'high' ? 8 : 4;
  const shadows = quality !== 'low';
  const shadowSize = quality === 'high' ? 2048 : 1024;

  // Shared (module-cached) materials: never disposed here.
  const mats = useMemo(() => {
    const env = getEnv(gl);
    const o = { hasNormal, anisotropy };
    const m = {
      floor:   pbr('stone-floor',  { ...o, fallbackColor: '#2a2a3c', tint: FLOOR_TINT, metalness: 0.4, roughness: 0.95, normalScale: 1.2, envMapIntensity: 0.5 }),
      wall:    pbr('wall-stone',   { ...o, fallbackColor: '#222238', tint: '#8c90b4', metalness: 0.2, roughness: 1, side: THREE.BackSide, envMapIntensity: 0.4 }),
      pillar:  pbr('stone-column', { ...o, fallbackColor: '#2a3050', tint: '#7078a0', metalness: 0.3, roughness: 1, envMapIntensity: 0.6 }),
      terrain: pbr('marble-white', { ...o, fallbackColor: '#3a3a55', tint: '#686c8c', metalness: 0.2, roughness: 0.9, envMapIntensity: 0.6 }),
    };
    for (const k of Object.keys(m) as (keyof typeof m)[]) m[k].envMap = env;
    return m;
  }, [gl, hasNormal, anisotropy]);

  // Domains tint the floor; restore the stone tint when they end.
  useEffect(() => {
    mats.floor.color.set(domainColor ?? FLOOR_TINT);
    return () => { mats.floor.color.set(FLOOR_TINT); };
  }, [mats, domainColor]);

  const floorGeo = useMemo(() => {
    const g = new THREE.CircleGeometry(ARENA_RADIUS, FLOOR_SEGMENTS);
    const n = (ARENA_RADIUS * 2) / TILE;
    return scaleUV(g, n, n);
  }, []);
  const wallGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS, ARENA_WALL_HEIGHT, WALL_SEGMENTS, 1, true);
    // Integer tile count around so the seam wraps cleanly.
    return scaleUV(g, Math.round((2 * Math.PI * ARENA_RADIUS) / TILE), ARENA_WALL_HEIGHT / TILE);
  }, []);
  useEffect(() => () => { floorGeo.dispose(); wallGeo.dispose(); }, [floorGeo, wallGeo]);

  return (
    <>
      {/* Ambient floor: prevents any surface from hitting pure black */}
      <ambientLight intensity={domainColor ? 0.4 : 0.5} color={domainColor ?? '#334466'} />

      {/* Hemisphere light: sky above, warm ground below: even readable fill */}
      <hemisphereLight
        args={[domainColor ?? '#8899cc', '#221133', domainColor ? 1.2 : 1.6]}
      />

      {/* The one shadow caster. Shadow frustum is fit to the arena disc (it is
          straight overhead, so the disc is exactly its footprint) and the
          depth range to the 0-8m of geometry that can cast. */}
      <directionalLight
        position={[0, 28, 0]}
        intensity={domainColor ? 1.5 : 3.2}
        color={domainColor ?? '#aabbdd'}
        castShadow={shadows}
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-camera-left={-ARENA_RADIUS - 1}
        shadow-camera-right={ARENA_RADIUS + 1}
        shadow-camera-top={ARENA_RADIUS + 1}
        shadow-camera-bottom={-ARENA_RADIUS - 1}
        shadow-camera-near={12}
        shadow-camera-far={32}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />

      {/* Angled fills (no shadows) so vertical faces read under the top light */}
      <directionalLight
        position={[20, 10, 15]}
        intensity={domainColor ? 0.4 : 1.0}
        color={domainColor ?? '#8899cc'}
      />
      <directionalLight
        position={[-20, 10, -15]}
        intensity={domainColor ? 0.4 : 0.8}
        color={domainColor ?? '#7788bb'}
      />

      {/* Floor */}
      <mesh geometry={floorGeo} material={mats.floor} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={shadows} />

      <FloorMarkings domainColor={domainColor} />

      {/* Circular wall */}
      <mesh geometry={wallGeo} material={mats.wall} position={[0, ARENA_WALL_HEIGHT / 2, 0]} />

      <Pillars radius={ARENA_RADIUS - 1.5} domainColor={domainColor} material={mats.pillar} shadows={shadows} />
      <Terrain material={mats.terrain} shadows={shadows} />
    </>
  );
}

/** All terrain pieces baked into ONE geometry (one draw call, one shadow draw). */
function Terrain({ material, shadows }: { material: THREE.Material; shadows: boolean }) {
  const geometry = useMemo(() => {
    const { walls, ramps, platforms } = TERRAIN_PIECES;
    const parts: THREE.BufferGeometry[] = [];

    for (const w of walls) {
      const g = worldBox(w.maxX - w.minX, w.height, w.maxZ - w.minZ, TILE);
      g.translate((w.minX + w.maxX) / 2, w.height / 2, (w.minZ + w.maxZ) / 2);
      parts.push(g);
    }

    for (const p of platforms) {
      const g = worldBox(p.maxX - p.minX, p.topY, p.maxZ - p.minZ, TILE);
      g.translate((p.minX + p.maxX) / 2, p.topY / 2, (p.minZ + p.maxZ) / 2);
      parts.push(g);
    }

    for (const r of ramps) {
      const span = r.axis === 'z' ? r.maxZ - r.minZ : r.maxX - r.minX;
      const rise = r.y1 - r.y0;
      const length = Math.sqrt(span * span + rise * rise);
      const angle = Math.atan2(rise, span);
      const crossWidth = r.axis === 'z' ? (r.maxX - r.minX) : (r.maxZ - r.minZ);
      // A thin box tilted to match the slope: rotation.x tilts along Z (axis='z'
      // ramps), rotation.z tilts along X (axis='x' ramps). Same transform the
      // old per-mesh version used; actual walkable collision comes from
      // terrainHeightAt, not this geometry.
      const g = r.axis === 'z'
        ? worldBox(crossWidth, 0.4, length, TILE)
        : worldBox(length, 0.4, crossWidth, TILE);
      const euler = r.axis === 'z' ? new THREE.Euler(-angle, 0, 0) : new THREE.Euler(0, 0, angle);
      g.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3((r.minX + r.maxX) / 2, (r.y0 + r.y1) / 2, (r.minZ + r.maxZ) / 2),
        new THREE.Quaternion().setFromEuler(euler),
        new THREE.Vector3(1, 1, 1),
      ));
      parts.push(g);
    }

    const merged = mergeGeometries(parts, false)!;
    parts.forEach((g) => g.dispose());
    return merged;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return <mesh geometry={geometry} material={material} castShadow={shadows} receiveShadow={shadows} />;
}

/** Orientation rings, centre marker and outer rim: one merged, vertex-coloured, unlit mesh. */
function FloorMarkings({ domainColor }: { domainColor: string | null }) {
  const geometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry, hex: string) => {
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0.01, 0);
      g.deleteAttribute('uv');
      const c = new THREE.Color(hex);
      const n = g.getAttribute('position').count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      parts.push(g);
    };
    const thickness = 0.35;
    const ring = (radius: number, hex: string) =>
      add(new THREE.RingGeometry(radius - thickness / 2, radius + thickness / 2, 64), hex);
    ring(ARENA_RADIUS * 0.25, '#3c3c78');
    ring(ARENA_RADIUS * 0.50, '#3c3c78');
    ring(ARENA_RADIUS * 0.72, '#4a4ab4');
    add(new THREE.CircleGeometry(1.2, 32), '#5a5aaa');
    add(new THREE.RingGeometry(ARENA_RADIUS - 0.8, ARENA_RADIUS - 0.4, WALL_SEGMENTS), '#6060c0');
    const merged = mergeGeometries(parts, false)!;
    parts.forEach((g) => g.dispose());
    return merged;
  }, []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    [],
  );
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  // Domain colour multiplies the (already bright) vertex colours; white = unchanged.
  useEffect(() => { material.color.set(domainColor ?? '#ffffff'); }, [material, domainColor]);

  return <mesh geometry={geometry} material={material} />;
}

function Pillars({ radius, domainColor, material, shadows }: {
  radius: number; domainColor: string | null; material: THREE.Material; shadows: boolean;
}) {
  const pillarRef = useRef<THREE.InstancedMesh>(null);
  const flameRef = useRef<THREE.InstancedMesh>(null);
  const poolRef = useRef<THREE.InstancedMesh>(null);

  const geos = useMemo(() => ({
    // Stands on the floor (previously centred on y=0, sinking half into it).
    pillar: scaleUV(new THREE.CylinderGeometry(0.4, 0.5, PILLAR_HEIGHT, 12), 1, PILLAR_HEIGHT / TILE),
    flame: new THREE.SphereGeometry(0.18, 8, 6),
    pool: new THREE.PlaneGeometry(1, 1),
  }), []);
  const glowTex = useMemo(makeGlowTexture, []);
  const flameMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ff7a22' }), []);
  const poolMat = useMemo(() => new THREE.MeshBasicMaterial({
    map: glowTex, color: '#ff8833', transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }), [glowTex]);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    for (let i = 0; i < PILLAR_COUNT; i++) {
      const a = (i / PILLAR_COUNT) * Math.PI * 2;
      const x = Math.sin(a) * radius, z = Math.cos(a) * radius;
      const inner = (radius - 3) / radius; // pull the pool inside the wall so it doesn't spill past the rim
      pillarRef.current!.setMatrixAt(i, m.makeTranslation(x, PILLAR_HEIGHT / 2, z));
      flameRef.current!.setMatrixAt(i, m.makeTranslation(x, PILLAR_HEIGHT + 0.2, z));
      // Light pool: flat on the floor, 9m across, centred 3m in from the pillar.
      poolRef.current!.setMatrixAt(i, m.compose(new THREE.Vector3(x * inner, 0.02, z * inner), q, new THREE.Vector3(9, 9, 1)));
    }
    for (const r of [pillarRef, flameRef, poolRef]) r.current!.instanceMatrix.needsUpdate = true;
  }, [radius]);

  useEffect(() => {
    flameMat.color.set(domainColor ?? '#ff7a22');
    poolMat.color.set(domainColor ?? '#ff8833');
    poolMat.opacity = domainColor ? 0.35 : 0.5;
  }, [domainColor, flameMat, poolMat]);

  useEffect(() => () => {
    Object.values(geos).forEach((g) => g.dispose());
    glowTex.dispose(); flameMat.dispose(); poolMat.dispose();
  }, [geos, glowTex, flameMat, poolMat]);

  return (
    <>
      <instancedMesh ref={pillarRef} args={[geos.pillar, material, PILLAR_COUNT]} castShadow={shadows} receiveShadow={shadows} frustumCulled={false} />
      <instancedMesh ref={flameRef} args={[geos.flame, flameMat, PILLAR_COUNT]} frustumCulled={false} />
      <instancedMesh ref={poolRef} args={[geos.pool, poolMat, PILLAR_COUNT]} frustumCulled={false} renderOrder={1} />
    </>
  );
}
