import * as THREE from 'three';

export interface CrystalMaterialProps {
  color: string;
  emissive: string;
  emissiveIntensity: number;
  flatShading: true;
  roughness: number;
  metalness: number;
  envMapIntensity: number;
  clearcoat: number;
  clearcoatRoughness: number;
  ior: number;
  reflectivity: number;
  transparent: true;
  opacity: number;
  depthWrite: false;
  side: THREE.Side;
}

/**
 * The two crystalline material characters every Crystalmancer visual picks
 * from -- see GemPlopSpell.tsx for the full why. Both spread onto a JSX
 * <meshPhysicalMaterial> or straight into `new THREE.MeshPhysicalMaterial(...)`
 * for the imperative useMemo scenes (AoeSpell/RuneSpell shard bursts, etc).
 *
 * "shine" -- a hard, mirror-bright gem: high metalness, near-zero roughness,
 * a clearcoat on top, just enough emissive to stay readable in shadow. For
 * solid crystal objects: shards, chunks, walls, anything that should read as
 * a faceted physical thing catching real light.
 *
 * "glow" -- inverts the balance: much lower metalness/higher roughness so it
 * stops reading as metallic, and a strong emissive so it reads as something
 * lit from within instead of lit from outside. For softer, field-like or
 * "charged" effects: auras, powerful runes, ambient domain light.
 */
export function crystalShine(color: string, opacity = 0.85): CrystalMaterialProps {
  return {
    color,
    emissive: color,
    emissiveIntensity: 0.25,
    flatShading: true,
    roughness: 0.05,
    metalness: 0.85,
    envMapIntensity: 4,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    ior: 1.9,
    reflectivity: 1,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  };
}

export function crystalGlow(color: string, glowColor: string = color, opacity = 0.7): CrystalMaterialProps {
  return {
    color,
    emissive: glowColor,
    emissiveIntensity: 0.9,
    flatShading: true,
    roughness: 0.35,
    metalness: 0.35,
    envMapIntensity: 2,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
    ior: 1.6,
    reflectivity: 0.6,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  };
}
