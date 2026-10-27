/**
 * Slim PBR material loader for the CC0 texture sets in public/textures/<id>/
 * ({color,normal,orm}.webp; ORM = R ambient occlusion, G roughness, B metal).
 *
 * Design notes (all driven by "the arena must stay cheap"):
 *  - Textures are cached per id (and per anisotropy), materials per id+options,
 *    so every mesh sharing a look shares both the GPU textures and the shader
 *    program.
 *  - A material renders immediately with its flat fallback colour and gets all
 *    of its maps swapped in together once they've loaded (one recompile, not
 *    one per map, and no half-textured frame).
 *  - Textures keep repeat 1/1. Tiling is baked into each geometry's UVs in
 *    world metres (see scaleUV), because one texture is shared by meshes of
 *    wildly different sizes and a per-texture `repeat` would stretch it.
 *  - Cached materials/textures are process-lifetime: components must NOT
 *    dispose them on unmount (React StrictMode remounts would otherwise leave
 *    the cache holding dead GPU resources).
 *  - aoMap reads the `uv` attribute (aoMap.channel defaults to 0 in r170), so
 *    geometries only need their normal single UV set.
 */
import * as THREE from 'three';

export interface PbrOptions {
  fallbackColor?: string;
  /** Multiplies the albedo map. */
  tint?: string;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  envMapIntensity?: number;
  /** false skips the normal map entirely (low quality tier). */
  hasNormal?: boolean;
  anisotropy?: number;
  side?: THREE.Side;
}

const loader = new THREE.TextureLoader();
const materialCache = new Map<string, THREE.MeshStandardMaterial>();
const textureCache = new Map<string, Promise<THREE.Texture>>();

function loadTexture(id: string, file: string, colorSpace: THREE.ColorSpace, anisotropy: number): Promise<THREE.Texture> {
  const key = `${id}/${file}:${anisotropy}`;
  let p = textureCache.get(key);
  if (!p) {
    p = new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(
        `${import.meta.env.BASE_URL}textures/${id}/${file}`,
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.colorSpace = colorSpace;
          t.anisotropy = anisotropy;
          resolve(t);
        },
        undefined,
        reject,
      );
    });
    textureCache.set(key, p);
  }
  return p;
}

export function pbr(id: string, options: PbrOptions = {}): THREE.MeshStandardMaterial {
  const key = `${id}:${JSON.stringify(options)}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const {
    fallbackColor = '#888888',
    tint = '#ffffff',
    roughness = 1,
    metalness = 1,
    normalScale = 1,
    envMapIntensity = 1,
    hasNormal = true,
    anisotropy = 4,
    side = THREE.FrontSide,
  } = options;

  const material = new THREE.MeshStandardMaterial({ color: fallbackColor, roughness: 0.8, metalness: 0, side });
  materialCache.set(key, material);

  Promise.all([
    loadTexture(id, 'color.webp', THREE.SRGBColorSpace, anisotropy),
    hasNormal ? loadTexture(id, 'normal.webp', THREE.NoColorSpace, anisotropy) : null,
    loadTexture(id, 'orm.webp', THREE.NoColorSpace, anisotropy),
  ])
    .then(([color, normal, orm]) => {
      material.map = color;
      material.color.set(tint);
      if (normal) {
        material.normalMap = normal;
        material.normalScale.set(normalScale, normalScale);
      }
      material.aoMap = orm;
      material.roughnessMap = orm;
      material.metalnessMap = orm;
      // With maps present these multiply the map values.
      material.roughness = roughness;
      material.metalness = metalness;
      material.envMapIntensity = envMapIntensity;
      material.needsUpdate = true;
    })
    .catch((err) => console.warn(`[pbr] failed to load texture set "${id}":`, err));

  return material;
}

/** Every material created so far (Arena uses this to apply env map / re-tint). */
export function allPbrMaterials(): THREE.MeshStandardMaterial[] {
  return [...materialCache.values()];
}

/** Scales a geometry's UVs in place: u by `su`, v by `sv` (tile counts across the geometry). */
export function scaleUV<G extends THREE.BufferGeometry>(geo: G, su: number, sv: number): G {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geo;
}

/**
 * Box whose UVs are in world metres / `tileSize` on every face, so texel
 * density is identical on a 0.6m-thick wall and a 6m platform. Face order of
 * BoxGeometry: +x,-x,+y,-y,+z,-z, 4 verts each.
 */
export function worldBox(w: number, h: number, d: number, tileSize: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const faces: [number, number][] = [
    [d, h], [d, h], // +x, -x : u across z, v across y
    [w, d], [w, d], // +y, -y : u across x, v across z
    [w, h], [w, h], // +z, -z : u across x, v across y
  ];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, (uv.getX(idx) * faces[f][0]) / tileSize, (uv.getY(idx) * faces[f][1]) / tileSize);
    }
  }
  uv.needsUpdate = true;
  return g;
}
