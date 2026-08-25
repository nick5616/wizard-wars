import * as THREE from 'three';

/**
 * A short, faceted, double-edged blade shard -- the same abstraction a cut
 * gem (see the rupee reference this was pulled from) already is: sharp on
 * two opposing edges, tapering to a point at both ends, flat-shaded so each
 * triangular facet catches light as a distinct plane instead of a smooth
 * blob. A blade reduces to that shape once you strip away the handle.
 *
 * Built by stretching a THREE.OctahedronGeometry(1, 0) -- its 6 vertices sit
 * at (±1,0,0)/(0,±1,0)/(0,0,±1), so a non-uniform scale turns the regular
 * octahedron into a thin blade: long on the tip-to-tip axis, wide on the
 * face axis, and -- the part that actually reads as "blade" instead of "fat
 * diamond" -- kept deliberately thin on the third.
 *
 * length: tip-to-tip (local +Y, meant to be aligned with a direction of travel)
 * width: edge-to-edge, the blade's visible face (local X)
 * thickness: front-to-back (local Z) -- keep small, this is the sharpness
 */
export function createBladeGeometry(length = 1, width = 0.42, thickness = 0.16): THREE.BufferGeometry {
  const geometry = new THREE.OctahedronGeometry(1, 0);
  geometry.scale(width / 2, length / 2, thickness / 2);
  return geometry;
}
