/**
 * Static arena terrain: ramps, raised platforms, and low cover walls.
 * Hand-placed data, shared verbatim by server (authoritative collision) and
 * client (rendering + local prediction) so both sides agree on geometry
 * without a physics engine — same hand-rolled-math style as the rest of the
 * movement/hit code in Room.js / ClientPrediction.ts.
 *
 * All pieces are axis-aligned (no rotation) to keep the collision math to
 * plain AABB checks. Coordinates stay well inside ARENA_RADIUS (30) and
 * clear of the 8 spawn points (all at radius ~20), leaving an untouched
 * outer ring for safe spawning/rotation.
 */

const STEP_TOLERANCE = 0.35; // how close to a platform's top a player's feet must be to "count" as standing on it

// ─── Data ────────────────────────────────────────────────────────────────

// walls: vertical cover, blocking sight/movement from the side. Tall enough
// (2.2) that a standing jump can't clear them (apex ~1 unit given
// JUMP_FORCE=6, GRAVITY=-18) -- but the top is walkable ground, same as a
// platform, so they're reachable via mobility dashes/launches or by
// stepping across from an adjacent platform at the same height.
const WALLS = [
  { id: 'cover_n', minX: -2.25, maxX: 2.25, minZ: -8.3, maxZ: -7.7, height: 2.2 },
  { id: 'cover_s', minX: -2.25, maxX: 2.25, minZ: 7.7, maxZ: 8.3, height: 2.2 },
  { id: 'cover_e', minX: 7.7, maxX: 8.3, minZ: -2.25, maxZ: 2.25, height: 2.2 },
  { id: 'cover_w', minX: -8.3, maxX: -7.7, minZ: -2.25, maxZ: 2.25, height: 2.2 },
];

// ramps: walkable sloped surfaces, interpolate height along one axis.
const RAMPS = [
  { id: 'ramp_ne', minX: 5, maxX: 11, minZ: 1.5, maxZ: 5, axis: 'z', y0: 0, y1: 2.2 },
  { id: 'ramp_sw', minX: -11, maxX: -5, minZ: -5, maxZ: -1.5, axis: 'z', y0: 2.2, y1: 0 },
];

// platforms: flat raised tops, solid sides below their top (reachable only via their ramp).
const PLATFORMS = [
  { id: 'platform_ne', minX: 5, maxX: 11, minZ: 5, maxZ: 11, topY: 2.2 },
  { id: 'platform_sw', minX: -11, maxX: -5, minZ: -11, maxZ: -5, topY: 2.2 },
];

export const TERRAIN_PIECES = {
  walls: WALLS,
  ramps: RAMPS,
  platforms: PLATFORMS,
};

// Precomputed once at module load (not per-raycast-call) since these are
// called extremely often -- every tick per active projectile/beam, every
// hitscan cast, and every bot AI decision -- and previously spread a new
// {...piece, minY, maxY} object on every single call.
const WALLS_RAYCAST = WALLS.map((w) => ({ ...w, minY: 0, maxY: w.height }));
const PLATFORMS_RAYCAST = PLATFORMS.map((p) => ({ ...p, minY: 0, maxY: p.topY }));

// ─── Generic AABB helpers (also usable by dynamically-created barriers) ───

/** Ray-vs-AABB (slab method). Returns entry distance `t` or null. */
export function rayIntersectsBox(origin, dir, box) {
  let tMin = 0;
  let tMax = Infinity;

  const axes = [
    ['x', box.minX, box.maxX],
    ['y', box.minY ?? 0, box.maxY ?? Infinity],
    ['z', box.minZ, box.maxZ],
  ];

  for (const [axis, lo, hi] of axes) {
    const o = origin[axis];
    const d = dir[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  return tMin >= 0 ? tMin : (tMax >= 0 ? tMax : null);
}

/** Circle (player, top-down) vs AABB (top-down footprint) overlap test. */
function circleOverlapsBoxXZ(x, z, radius, box) {
  const closestX = Math.max(box.minX, Math.min(x, box.maxX));
  const closestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
  const dx = x - closestX;
  const dz = z - closestZ;
  return (dx * dx + dz * dz) < radius * radius;
}

/** Pushes {x,z} out of a box's XZ footprint along the shortest axis. Mutates nothing; returns a new {x,z}. */
function pushOutOfBoxXZ(x, z, radius, box) {
  const closestX = Math.max(box.minX, Math.min(x, box.maxX));
  const closestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
  let dx = x - closestX;
  let dz = z - closestZ;
  let dist = Math.sqrt(dx * dx + dz * dz);

  if (dist < 1e-6) {
    // Center is inside the box — push out along the shallowest penetration axis.
    const penLeft = x - box.minX, penRight = box.maxX - x;
    const penNear = z - box.minZ, penFar = box.maxZ - z;
    const minPen = Math.min(penLeft, penRight, penNear, penFar);
    if (minPen === penLeft) return { x: box.minX - radius, z };
    if (minPen === penRight) return { x: box.maxX + radius, z };
    if (minPen === penNear) return { x, z: box.minZ - radius };
    return { x, z: box.maxZ + radius };
  }

  const push = (radius - dist) / dist;
  return { x: x + dx * push, z: z + dz * push };
}

// ─── Terrain-specific queries ──────────────────────────────────────────────

/** Walkable surface Y at a given XZ (0 = open floor). Ramps interpolate; platforms and wall tops are flat. */
export function terrainHeightAt(x, z) {
  let y = 0;

  for (const ramp of RAMPS) {
    if (x < ramp.minX || x > ramp.maxX || z < ramp.minZ || z > ramp.maxZ) continue;
    const span = ramp.axis === 'z' ? (ramp.maxZ - ramp.minZ) : (ramp.maxX - ramp.minX);
    const pos = ramp.axis === 'z' ? (z - ramp.minZ) : (x - ramp.minX);
    const t = span > 0 ? Math.max(0, Math.min(1, pos / span)) : 0;
    const rampY = ramp.y0 + (ramp.y1 - ramp.y0) * t;
    y = Math.max(y, rampY);
  }

  for (const plat of PLATFORMS) {
    if (x < plat.minX || x > plat.maxX || z < plat.minZ || z > plat.maxZ) continue;
    y = Math.max(y, plat.topY);
  }

  // Wall tops are walkable too (reachable via a mobility dash/launch, or by
  // stepping across from a platform at the same height) -- covered here so
  // landing on one is recognized as solid ground rather than falling through.
  for (const wall of WALLS) {
    if (x < wall.minX || x > wall.maxX || z < wall.minZ || z > wall.maxZ) continue;
    y = Math.max(y, wall.height);
  }

  return y;
}

/**
 * Pushes a circle (player) out of solid terrain. Both walls and platforms
 * only block from the side while the player's feet are meaningfully below
 * their top (i.e. hasn't climbed/landed on top yet) -- once standing on top,
 * side collision no longer fights the player back off it.
 */
export function resolveTerrainCollision(x, z, radius, feetY) {
  let px = x, pz = z;

  for (const wall of WALLS) {
    if (feetY >= wall.height - STEP_TOLERANCE) continue; // standing on top of the wall
    if (circleOverlapsBoxXZ(px, pz, radius, wall)) {
      const pushed = pushOutOfBoxXZ(px, pz, radius, wall);
      px = pushed.x; pz = pushed.z;
    }
  }

  for (const plat of PLATFORMS) {
    if (feetY >= plat.topY - STEP_TOLERANCE) continue; // already on top / stepping up
    if (circleOverlapsBoxXZ(px, pz, radius, plat)) {
      const pushed = pushOutOfBoxXZ(px, pz, radius, plat);
      px = pushed.x; pz = pushed.z;
    }
  }

  return { x: px, z: pz };
}

/**
 * Ray-vs-terrain block test for hitscan/beam/projectile line-of-sight.
 * Ramps are walkable ground, not obstacles, so only walls + the solid volume
 * below a platform's top (0..topY) can block a ray.
 * Returns the nearest block distance, or null if unobstructed within maxDist.
 */
export function terrainRaycastBlocked(origin, dir, maxDist) {
  let nearest = null;

  for (const wall of WALLS_RAYCAST) {
    const t = rayIntersectsBox(origin, dir, wall);
    if (t !== null && t <= maxDist && (nearest === null || t < nearest)) nearest = t;
  }

  for (const plat of PLATFORMS_RAYCAST) {
    const t = rayIntersectsBox(origin, dir, plat);
    if (t !== null && t <= maxDist && (nearest === null || t < nearest)) nearest = t;
  }

  return nearest;
}

export { circleOverlapsBoxXZ, pushOutOfBoxXZ };

// ─── Dynamic circular obstacles (spell-cast barriers) ──────────────────────
// Barriers (Ice Wall / Rock Wall) are runtime, per-room state, not static
// map data — but movement/ray collision against them uses the same simple
// circle math on both client and server, so it lives here for reuse.

/** Pushes {x,z} out of any overlapping circle in `circles` ({x,z,radius}[]). */
export function resolveCircleObstacles(x, z, radius, circles) {
  let px = x, pz = z;
  for (const c of circles) {
    const dx = px - c.x, dz = pz - c.z;
    const minDist = c.radius + radius;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist >= minDist) continue;
    if (dist < 1e-6) { px += minDist; continue; } // degenerate: centers coincide, push arbitrarily
    const push = (minDist - dist) / dist;
    px += dx * push;
    pz += dz * push;
  }
  return { x: px, z: pz };
}

/**
 * Ray-vs-vertical-cylinder test (XZ circle + Y band) for a single circle obstacle
 * `{x, z, radius, baseY, height}`. Returns entry distance `t` or null.
 */
export function rayIntersectsCylinder(origin, dir, circle) {
  const ox = origin.x - circle.x;
  const oz = origin.z - circle.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a < 1e-8) return null;
  const b = 2 * (ox * dir.x + oz * dir.z);
  const c = ox * ox + oz * oz - circle.radius * circle.radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return null;
  const hitY = origin.y + dir.y * t;
  const baseY = circle.baseY ?? 0;
  if (hitY < baseY || hitY > baseY + circle.height) return null;
  return t;
}
