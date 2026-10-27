/**
 * Client-side prediction and server reconciliation.
 *
 * Flow:
 *  1. Client applies input locally → predicts new position. One input is
 *     generated per fixed 1/64s predicted step (see CameraController), so the
 *     server's one-step-per-input simulation walks exactly the same path.
 *  2. Client sends input with a sequence number.
 *  3. Server acknowledges with ackSeq in each GAME_TICK.
 *  4. On receiving ack, client discards inputs ≤ ackSeq.
 *  5. Client re-simulates remaining unacknowledged inputs from the server
 *     state (position + velocity) to correct any drift.
 */

import {
  BASE_MOVE_SPEED, JUMP_FORCE, GRAVITY, PLAYER_HEIGHT, ARENA_RADIUS, PLAYER_CAPSULE_RADIUS,
  GROUND_ACCEL, AIR_ACCEL, GROUND_FRICTION, STOP_SPEED, AIR_CAP_SPEED, MAX_AIR_JUMPS,
} from 'shared/constants';
import { terrainHeightAt, resolveTerrainCollision, resolveCircleObstacles } from 'shared/mapLayout';
import {
  applyGroundFriction, applyGroundAccel, applyAirAccel, normalizeWishDir,
  effectSpeedMultiplier, domainSpeedMultiplier, applyMobilityKinematics,
} from 'shared/movement';
import { MOBILITY_SPELL, getSpell } from 'shared/spells';
import { INPUT_FLAGS } from 'shared/events';
import type { Vec3, PendingInput, DomainState } from '../types/game.types';
import { useGameStore } from '../stores/gameStore';
import { netDebug } from './netDebug';

export interface CircleObstacle { x: number; z: number; radius: number; }

/** Movement state carried between predicted steps (and replayed from the server's by reconcile). */
export interface PredState { pos: Vec3; vel: Vec3; airJumpsUsed: number; }

/** One sent input plus the predicted state right after it -- reconcile reads the post-ack one to know the velocity/air-jump count the server is at. */
export interface StepRecord extends PendingInput {
  vel: Vec3;
  airJumpsUsed: number;
  /** The mobility (Shift) press was predicted as accepted for this step. */
  mobilityApplied: boolean;
}

/**
 * Everything besides input that changes how fast/where a step moves: status
 * effects (slow, freeze, stun, phase), domains and passives. Mirrors the
 * multiplier Room._stepPlayer computes server-side; the client used to
 * hardcode 1.0, so every slow/freeze/domain was a constant correction.
 */
export interface MoveContext {
  speedMult: number;
  immobilized: boolean;
  /** Stun specifically: the server also denies mobility (Shift) while stunned, unlike freeze/petrify. */
  stunned: boolean;
  playerClass: string | null;
  unlockedNodes: Set<string>;
  launchForce: number;
}

export const DEFAULT_MOVE_CONTEXT: MoveContext = {
  speedMult: 1, immobilized: false, stunned: false, playerClass: null, unlockedNodes: new Set(), launchForce: 20,
};

/** Builds the MoveContext from the latest synced store state at server time `serverNowMs`. */
export function buildMoveContext(localId: string, serverNowMs: number): MoveContext {
  const { local, domains } = useGameStore.getState();
  const has = (name: string) => {
    const e = local.activeEffects?.[name];
    return !!e && serverNowMs <= e.expiresAt;
  };
  const nodes = new Set<string>(local.unlockedNodes ?? []);
  const footwork = local.class === 'sword' && nodes.has('footwork') ? 1.08 : 1;
  let domain: DomainState | null = null;
  for (const d of Object.values(domains ?? {})) { if (d.active) { domain = d; break; } }
  const effectMult = effectSpeedMultiplier(has, local.class);
  const mobilitySpell = local.class ? getSpell(MOBILITY_SPELL[local.class as keyof typeof MOBILITY_SPELL]) : null;
  return {
    speedMult: effectMult * footwork * domainSpeedMultiplier(domain, localId, serverNowMs),
    immobilized: has('stun') || effectMult === 0,
    stunned: has('stun'),
    playerClass: local.class,
    unlockedNodes: nodes,
    launchForce: (mobilitySpell as { launchForce?: number } | null)?.launchForce ?? 20,
  };
}

export class ClientPrediction {
  private seq = 0;
  private pending: StepRecord[] = [];
  /** Latest acked step, kept after its record is dropped so reconcile still has a velocity to start from when the server doesn't send one. */
  private lastAcked: StepRecord | null = null;
  private ctx: MoveContext = DEFAULT_MOVE_CONTEXT;
  /** Set by reconcile, consumed by CameraController once per rendered frame (the newest wins). */
  private correction: PredState | null = null;

  nextSeq() {
    return ++this.seq;
  }

  /** Per-frame/tick movement modifiers (see MoveContext). */
  setMoveContext(ctx: MoveContext) {
    this.ctx = ctx;
  }

  get moveContext() {
    return this.ctx;
  }

  get unackedCount() {
    return this.pending.length;
  }

  /** Drop all in-flight input history: respawn, reconnect, class change. Seq keeps counting so the server's stale-seq filter never rejects the fresh stream. */
  reset() {
    this.pending = [];
    this.lastAcked = null;
    this.correction = null;
  }

  /** Newest reconciled state since the last call, or null. */
  takeCorrection(): PredState | null {
    const c = this.correction;
    this.correction = null;
    return c;
  }

  /** Predict where the player will be after applying this input locally. */
  predict(
    currentPos: Vec3, currentVel: Vec3, flags: number, yaw: number, dt: number,
    barriers: CircleObstacle[] = [], airJumpsUsed = 0, mobilityApplied = false,
  ): { pos: Vec3; vel: Vec3; airJumpsUsed: number } {
    const speed = BASE_MOVE_SPEED * this.ctx.speedMult;

    // Mobility (Shift) lands before the movement step, same as the server's
    // Room._stepPlayer -> SpellSystem.handleMobility.
    let launched = false;
    if (mobilityApplied) {
      const p = { x: currentPos.x, y: currentPos.y, z: currentPos.z };
      const v = { x: currentVel.x, y: currentVel.y, z: currentVel.z };
      launched = applyMobilityKinematics(this.ctx.playerClass, this.ctx.unlockedNodes, p, v, flags, yaw, this.ctx.launchForce);
      currentPos = p;
      currentVel = v;
    }

    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    let wishX = 0, wishZ = 0;

    if (flags & 1)  { wishZ -= cos; wishX -= sin; }
    if (flags & 2)  { wishZ += cos; wishX += sin; }
    if (flags & 4)  { wishZ += sin; wishX -= cos; }
    if (flags & 8)  { wishZ -= sin; wishX += cos; }

    let wishDir = normalizeWishDir(wishX, wishZ);
    if (this.ctx.immobilized) wishDir = { x: 0, z: 0 };

    // Grounded is whatever the previous step's snap left behind: the server
    // keeps it as state (set exactly at y === groundY), so a tolerance here
    // (it was 0.05) made the client apply air physics to a descending player
    // the server still considered grounded, or vice versa.
    const currentGroundY = PLAYER_HEIGHT + terrainHeightAt(currentPos.x, currentPos.z);
    const isGrounded = !launched && currentPos.y <= currentGroundY + 1e-4;

    // Source-engine-style ground/air acceleration (see shared/movement.js) --
    // mirrors server/src/Room.js _stepPlayer exactly so reconciliation
    // doesn't fight prediction.
    const vel = { x: currentVel.x, z: currentVel.z };
    if (isGrounded) {
      applyGroundFriction(vel, GROUND_FRICTION, STOP_SPEED, dt);
      applyGroundAccel(vel, wishDir, speed, GROUND_ACCEL, dt);
    } else {
      applyAirAccel(vel, wishDir, speed, AIR_ACCEL, AIR_CAP_SPEED, dt);
    }
    // Stun/freeze is a hard lock (kills residual momentum too), see Room._stepPlayer.
    if (this.ctx.immobilized) { vel.x = 0; vel.z = 0; }
    let vx = vel.x, vz = vel.z;

    let vy = currentVel.y;
    if (!isGrounded) vy += GRAVITY * dt;

    let nextAirJumpsUsed = airJumpsUsed;
    if ((flags & INPUT_FLAGS.JUMP) && isGrounded) {
      vy = JUMP_FORCE;
      nextAirJumpsUsed = 0;
    } else if (!isGrounded && (flags & INPUT_FLAGS.JUMP_EDGE) && airJumpsUsed < MAX_AIR_JUMPS) {
      vy = JUMP_FORCE;
      nextAirJumpsUsed = airJumpsUsed + 1;
    }

    let x = currentPos.x + vx * dt;
    let y = currentPos.y + vy * dt;
    let z = currentPos.z + vz * dt;

    // Terrain + barriers: push out of walls/platform sides and any active spell
    // barrier, same as the server's Room._stepPlayer.
    const feetYBeforeCollision = y - PLAYER_HEIGHT;
    const resolved = resolveTerrainCollision(x, z, PLAYER_CAPSULE_RADIUS, feetYBeforeCollision);
    x = resolved.x;
    z = resolved.z;
    if (barriers.length > 0) {
      const barrierResolved = resolveCircleObstacles(x, z, PLAYER_CAPSULE_RADIUS, barriers);
      x = barrierResolved.x;
      z = barrierResolved.z;
    }

    // Same ground-snap tolerance as the server, so ramp descent doesn't
    // stutter and prediction doesn't fight reconciliation near terrain.
    const groundY = PLAYER_HEIGHT + terrainHeightAt(x, z);
    const huggingSurface = vy <= 0 && (y - groundY) <= 0.3;
    if (y <= groundY || huggingSurface) { y = groundY; vy = 0; nextAirJumpsUsed = 0; }

    const dist = Math.sqrt(x * x + z * z);
    if (dist > ARENA_RADIUS - 1) {
      const s = (ARENA_RADIUS - 1) / dist;
      x *= s; z *= s;
    }

    return {
      pos: { x, y, z },
      vel: { x: vx, y: vy, z: vz },
      airJumpsUsed: nextAirJumpsUsed,
    };
  }

  /** Store an input for later reconciliation. */
  store(input: StepRecord) {
    this.pending.push(input);
    // Cap pending buffer to avoid unbounded growth. 256 steps = 4s of
    // unacked input; at 128 an 'awful' link (constant TCP-style stalls) overran
    // it, and a trimmed history can't be replayed, which showed as snaps.
    if (this.pending.length > 256) this.pending.shift();
  }

  /**
   * Reconcile: server sent its authoritative state after simulating input
   * `ackSeq`. Discard all inputs ≤ ackSeq, then replay the rest from that
   * state (position + velocity + air jumps) to get the corrected present.
   * The result is left for CameraController (takeCorrection).
   *
   * The replay needs the server's velocity: starting from zero (as this used
   * to) makes every unacked step re-accelerate from a standstill, a systematic
   * undershoot that grows with latency. When the server doesn't send velocity
   * we start from our own recorded post-ack velocity, which is exact whenever
   * prediction matched.
   */
  reconcile(
    serverPos: Vec3,
    ackSeq: number,
    serverVel: Vec3 | undefined,
    barriers: CircleObstacle[] = [],
  ): PredState {
    for (const i of this.pending) {
      if (i.seq > ackSeq) break;
      this.lastAcked = i;
    }
    if (netDebug.enabled && this.lastAcked && this.lastAcked.seq === ackSeq) {
      // Sim-mismatch probe: server state at the acked step vs what we predicted for that same step.
      const p = this.lastAcked.predictedPosition;
      netDebug.lastAckErr = Math.hypot(serverPos.x - p.x, serverPos.y - p.y, serverPos.z - p.z);
    }
    this.pending = this.pending.filter(i => i.seq > ackSeq);

    let pos = { ...serverPos };
    let vel = serverVel ? { ...serverVel } : this.lastAcked ? { ...this.lastAcked.vel } : { x: 0, y: 0, z: 0 };
    // The server doesn't report air jumps; our recorded value at the acked step is exact when prediction matched.
    let airJumpsUsed = this.lastAcked?.airJumpsUsed ?? 0;
    const dt = 1 / 64; // one tick

    for (const input of this.pending) {
      const result = this.predict(pos, vel, input.flags, input.yaw, dt, barriers, airJumpsUsed, input.mobilityApplied);
      pos = result.pos;
      vel = result.vel;
      airJumpsUsed = result.airJumpsUsed;
    }

    const state = { pos, vel, airJumpsUsed };
    this.correction = state;
    return state;
  }
}
