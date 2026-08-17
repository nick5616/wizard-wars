/**
 * Source-engine-style movement helpers (ground accel + friction, air-strafe
 * acceleration) shared by the server's authoritative simulation
 * (server/src/Room.js) and the client's local prediction
 * (client/src/networking/ClientPrediction.ts) so the two stay in sync --
 * any drift here causes visible reconciliation jitter.
 */

/** Ground friction: decelerates horizontal velocity, stronger below stopSpeed so players actually stop instead of sliding forever at low speed. */
export function applyGroundFriction(vel, friction, stopSpeed, dt) {
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (speed < 0.01) { vel.x = 0; vel.z = 0; return; }
  const control = speed < stopSpeed ? stopSpeed : speed;
  const drop = control * friction * dt;
  const newSpeed = Math.max(speed - drop, 0) / speed;
  vel.x *= newSpeed;
  vel.z *= newSpeed;
}

/** Ground acceleration toward the wish direction, clamped so a single tick never overshoots wishSpeed. */
export function applyGroundAccel(vel, wishDir, wishSpeed, accel, dt) {
  const currentSpeed = vel.x * wishDir.x + vel.z * wishDir.z;
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) return;
  const accelSpeed = Math.min(accel * dt * wishSpeed, addSpeed);
  vel.x += accelSpeed * wishDir.x;
  vel.z += accelSpeed * wishDir.z;
}

/**
 * Air acceleration a la Source/Quake PM_AirAccelerate: the wishSpeed used
 * for the addSpeed check is clamped to airCapSpeed, but the accel rate
 * itself still scales with the full (uncapped) wishSpeed -- that mismatch
 * is exactly what lets strafe-jumping gain speed beyond normal run speed
 * (bunny hopping), same as Source engine games.
 */
export function applyAirAccel(vel, wishDir, wishSpeed, accel, airCapSpeed, dt) {
  const cappedWishSpeed = Math.min(wishSpeed, airCapSpeed);
  const currentSpeed = vel.x * wishDir.x + vel.z * wishDir.z;
  const addSpeed = cappedWishSpeed - currentSpeed;
  if (addSpeed <= 0) return;
  const accelSpeed = Math.min(accel * dt * wishSpeed, addSpeed);
  vel.x += accelSpeed * wishDir.x;
  vel.z += accelSpeed * wishDir.z;
}

/** Normalize a raw input-key direction sum into a unit wish-direction (or the zero vector if no keys are held). */
export function normalizeWishDir(x, z) {
  const len = Math.sqrt(x * x + z * z);
  if (len === 0) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
}
