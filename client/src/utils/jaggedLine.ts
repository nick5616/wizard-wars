/**
 * Shared "electric arc" line-building helper: a jagged polyline between two
 * (or more) points, offset by random perpendicular jitter at each interior
 * step. Used by lightning-flavored spell visuals (Chain Lightning, Lightning
 * Strike) so the electricity reads as crackling rather than a flat laser.
 */

import * as THREE from 'three';

/** Jagged positions along a single A→B leg. Endpoints are exact (no jitter). */
export function buildJaggedSegment(a: THREE.Vector3, b: THREE.Vector3, segments: number, jitter: number): number[] {
  const out: number[] = [];
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t;
    const edge = s === 0 || s === segments;
    const jx = edge ? 0 : (Math.random() - 0.5) * jitter;
    const jy = edge ? 0 : (Math.random() - 0.5) * jitter * 0.6;
    const jz = edge ? 0 : (Math.random() - 0.5) * jitter;
    out.push(x + jx, y + jy, z + jz);
  }
  return out;
}

/** Jagged positions through a full multi-point path (caster → target → target → ...). */
export function buildJaggedPath(points: THREE.Vector3[], segmentsPerLeg: number, jitter: number): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    out.push(...buildJaggedSegment(points[i], points[i + 1], segmentsPerLeg, jitter));
  }
  return new Float32Array(out);
}
