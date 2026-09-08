import * as THREE from 'three';

/**
 * A hexagonal bipyramid -- the classic cut-gem/rupee silhouette: a ring of
 * six equatorial vertices with a sharp apex above and below, flat-shaded so
 * each of the 12 triangular facets catches light as its own distinct plane
 * (see bladeGeometry.ts, which pulls the same faceted-gem trick off this
 * shape's sibling -- flatShading recomputes a per-face normal from screen-
 * space derivatives, so shared/indexed vertices still render hard-edged).
 * Built from vertex/index arrays directly since three.js has no built-in
 * bipyramid primitive.
 *
 * radius: equatorial half-width. height: apex-to-apex; the top point sits
 * higher than the bottom sinks, so the "waist" (widest ring) reads near the
 * top third rather than dead center -- closer to a cut gem than a plain
 * diamond octahedron.
 */
export function createRupeeGeometry(radius = 0.5, height = 0.85): THREE.BufferGeometry {
  const segments = 6;
  const topY = height * 0.55;
  const bottomY = -height * 0.45;

  const positions: number[] = [];
  const indices: number[] = [];

  const ring: number[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    ring.push(positions.length / 3);
    positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
  }
  const topIdx = positions.length / 3;
  positions.push(0, topY, 0);
  const bottomIdx = positions.length / 3;
  positions.push(0, bottomY, 0);

  for (let i = 0; i < segments; i++) {
    const a = ring[i], b = ring[(i + 1) % segments];
    indices.push(topIdx, a, b);
    indices.push(bottomIdx, b, a);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
