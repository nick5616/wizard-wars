import { DOMAIN_CONFIGS } from './gameConfig.js';

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

// ── Speed modifiers + mobility kinematics ───────────────────────────────────
// Both sides need the exact same speed multiplier and mobility (Shift) motion,
// or every slow/freeze/domain/dash shows up as a reconciliation snap. These
// mirror Player.getSpeedMultiplier, Room._domainSpeedMultiplier and the
// kinematic part of SpellSystem._magmaDash/_glacierStep/_phaseSlip/_swordLunge/
// _stoneLaunch (damage, trails and cooldowns stay server-only).

/**
 * Status-effect speed multiplier. `has(name)` answers "is this effect active
 * right now" (server: Player.hasEffect; client: local activeEffects vs the
 * server clock).
 */
export function effectSpeedMultiplier(has, playerClass) {
  let mult = 1.0;
  if (has('slow')) mult *= 0.6;
  if (has('freeze') || has('petrify')) mult = 0;
  if (has('phase') && playerClass === 'dark') mult = 1.2;
  return mult;
}

/** Speed multiplier from the active domain (if any) for `playerId`; `nowMs` is server time. */
export function domainSpeedMultiplier(domain, playerId, nowMs) {
  if (!domain || nowMs < domain.activatesAt) return 1;
  const config = DOMAIN_CONFIGS[domain.spellId];
  if (!config) return 1;
  const isOwner = domain.ownerId === playerId;
  switch (domain.spellId) {
    case 'absolute_zero':  return isOwner ? 1 : (config.speedMultiplier ?? 1);
    case 'the_last_word':  return isOwner ? 1 : (config.otherSpeedMultiplier ?? 1);
    case 'wildwood_domain':
    case 'prism_field':    return isOwner ? (config.ownerSpeedMultiplier ?? 1) : (config.otherSpeedMultiplier ?? 1);
    default: return 1;
  }
}

/** Dash direction for a mobility press: held movement keys, else straight ahead (SpellSystem._getDashDir). */
export function dashDirection(flags, yaw) {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  let dx = 0, dz = 0;
  if (flags & 1) { dz -= cos; dx -= sin; }
  if (flags & 2) { dz += cos; dx += sin; }
  if (flags & 4) { dz += sin; dx -= cos; }
  if (flags & 8) { dz -= sin; dx += cos; }
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.01) return { x: -sin, z: -cos };
  return { x: dx / len, z: dz / len };
}

/**
 * Kinematic effect of the class mobility spell on position/velocity, applied
 * in place right before the movement step of the input that triggered it.
 * Returns true if it launched the player upward (grounded flag must clear).
 */
export function applyMobilityKinematics(playerClass, unlockedNodes, pos, vel, flags, yaw, launchForce = 20) {
  const dir = dashDirection(flags, yaw);
  switch (playerClass) {
    case 'fire':  pos.x += dir.x * 6; pos.z += dir.z * 6; return false;
    case 'ice': {
      const dist = unlockedNodes.has('cryogenic') ? 10 : 8;
      pos.x += dir.x * dist; pos.z += dir.z * dist; return false;
    }
    case 'sword': pos.x += dir.x * 7; pos.z += dir.z * 7; return false;
    case 'dark':  vel.x = dir.x * 14; vel.z = dir.z * 14; return false;
    case 'druid':
    case 'crystalmancer': vel.y = launchForce; return true;
  }
  return false;
}
