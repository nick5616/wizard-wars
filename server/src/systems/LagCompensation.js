/**
 * Maintains a rolling buffer of game state snapshots.
 * When a hit must be resolved, rewind to the snapshot closest to the
 * client's timestamp and check positions there.
 */
export class LagCompensation {
  constructor(maxSnapshots) {
    this.maxSnapshots = maxSnapshots;
    this.snapshots = []; // { tick, timestamp, state }
  }

  save(tick, timestamp, state) {
    this.snapshots.push({ tick, timestamp, state });
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  /** Find snapshot closest to the given server timestamp. */
  getSnapshotAt(timestamp) {
    if (this.snapshots.length === 0) return null;

    let best = this.snapshots[0];
    let bestDiff = Math.abs(timestamp - best.timestamp);

    for (const snap of this.snapshots) {
      const diff = Math.abs(timestamp - snap.timestamp);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = snap;
      }
    }
    return best;
  }

  /**
   * Check if a ray hit a player at the given historical timestamp.
   * origin, direction: {x,y,z} normalized ray
   * radius: hitbox half-width (capsule approximation)
   * Returns { hit: bool, playerId?, distance?, isHeadshot? }
   *
   * player.position.y is eye level on the server.
   * Head sphere: pos.y - 0.2 (radius 0.22), body sphere: pos.y - 0.9 (radius 0.5)
   */
  rayCast(origin, direction, radius, shooterId, timestamp) {
    const snap = this.getSnapshotAt(timestamp);
    if (!snap) return { hit: false };

    let closest = null;
    let closestDist = Infinity;
    let closestIsHeadshot = false;

    for (const [playerId, playerSnap] of Object.entries(snap.state.players)) {
      if (playerId === shooterId) continue;
      if (!playerSnap.isAlive) continue;

      const pos = playerSnap.position;
      const headCenter = { x: pos.x, y: pos.y - 0.2, z: pos.z };
      const bodyCenter = { x: pos.x, y: pos.y - 0.9, z: pos.z };
      const headDist = this._raySphereIntersect(origin, direction, headCenter, radius + 0.22);
      const bodyDist = this._raySphereIntersect(origin, direction, bodyCenter, radius + 0.5);
      const isHeadshot = headDist !== null && (bodyDist === null || headDist <= bodyDist);
      const hitDist = headDist ?? bodyDist;

      if (hitDist !== null && hitDist < closestDist) {
        closestDist = hitDist;
        closest = playerId;
        closestIsHeadshot = isHeadshot;
      }
    }

    return closest
      ? { hit: true, playerId: closest, distance: closestDist, isHeadshot: closestIsHeadshot }
      : { hit: false };
  }

  /**
   * Check if a sphere (projectile) overlaps any player at a given timestamp.
   */
  sphereOverlap(center, radius, shooterId, timestamp) {
    const snap = this.getSnapshotAt(timestamp);
    if (!snap) return [];

    const hits = [];
    for (const [playerId, playerSnap] of Object.entries(snap.state.players)) {
      if (playerId === shooterId) continue;
      if (!playerSnap.isAlive) continue;

      const pos = playerSnap.position;
      const dx = center.x - pos.x;
      const dy = center.y - (pos.y - 0.9); // body center (pos.y is eye level)
      const dz = center.z - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < radius + 0.5) { // 0.5 = player body radius
        hits.push({ playerId, distance: dist });
      }
    }
    return hits;
  }

  _raySphereIntersect(origin, direction, center, radius) {
    const ox = origin.x - center.x;
    const oy = origin.y - center.y;
    const oz = origin.z - center.z;

    const a = direction.x * direction.x + direction.y * direction.y + direction.z * direction.z;
    const b = 2 * (ox * direction.x + oy * direction.y + oz * direction.z);
    const c = ox * ox + oy * oy + oz * oz - radius * radius;

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;

    const t = (-b - Math.sqrt(discriminant)) / (2 * a);
    return t > 0 ? t : null;
  }
}
