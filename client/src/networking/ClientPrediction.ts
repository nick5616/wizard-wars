/**
 * Client-side prediction and server reconciliation.
 *
 * Flow:
 *  1. Client applies input locally → predicts new position.
 *  2. Client sends input with a sequence number.
 *  3. Server acknowledges with ackSeq in each GAME_TICK.
 *  4. On receiving ack, client discards inputs ≤ ackSeq.
 *  5. Client re-simulates remaining unacknowledged inputs from the server
 *     position to correct any drift.
 */

import { BASE_MOVE_SPEED, JUMP_FORCE, GRAVITY, PLAYER_HEIGHT, ARENA_RADIUS, PLAYER_CAPSULE_RADIUS } from 'shared/constants';
import { terrainHeightAt, resolveTerrainCollision, resolveCircleObstacles } from 'shared/mapLayout';
import type { Vec3, PendingInput } from '../types/game.types';

export interface CircleObstacle { x: number; z: number; radius: number; }

export class ClientPrediction {
  private seq = 0;
  private pending: PendingInput[] = [];

  nextSeq() {
    return ++this.seq;
  }

  /** Predict where the player will be after applying this input locally. */
  predict(currentPos: Vec3, currentVel: Vec3, flags: number, yaw: number, dt: number, barriers: CircleObstacle[] = []): { pos: Vec3; vel: Vec3 } {
    const speedMult = 1.0; // passives can modify later
    const speed = BASE_MOVE_SPEED * speedMult;

    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    let vx = 0, vz = 0;

    if (flags & 1)  { vz -= cos; vx -= sin; }
    if (flags & 2)  { vz += cos; vx += sin; }
    if (flags & 4)  { vz += sin; vx -= cos; }
    if (flags & 8)  { vz -= sin; vx += cos; }

    const len = Math.sqrt(vx * vx + vz * vz);
    if (len > 0) { vx = (vx / len) * speed; vz = (vz / len) * speed; }

    let vy = currentVel.y;
    const currentGroundY = PLAYER_HEIGHT + terrainHeightAt(currentPos.x, currentPos.z);
    const isGrounded = currentPos.y <= currentGroundY + 0.05;

    if (!isGrounded) vy += GRAVITY * dt;

    if ((flags & 16) && isGrounded) {
      vy = JUMP_FORCE;
    }

    let x = currentPos.x + vx * dt;
    let y = currentPos.y + vy * dt;
    let z = currentPos.z + vz * dt;

    // Terrain + barriers: push out of walls/platform sides and any active spell
    // barrier, same as the server's Room._simulatePlayer.
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
    if (y <= groundY || huggingSurface) { y = groundY; vy = 0; }

    const dist = Math.sqrt(x * x + z * z);
    if (dist > ARENA_RADIUS - 1) {
      const s = (ARENA_RADIUS - 1) / dist;
      x *= s; z *= s;
    }

    return {
      pos: { x, y, z },
      vel: { x: vx, y: vy, z: vz },
    };
  }

  /** Store an input for later reconciliation. */
  store(input: PendingInput) {
    this.pending.push(input);
    // Cap pending buffer to avoid unbounded growth
    if (this.pending.length > 128) this.pending.shift();
  }

  /**
   * Reconcile: server sent its authoritative position at ackSeq.
   * Discard all inputs ≤ ackSeq, then replay remaining inputs
   * from the server's position to get corrected predicted position.
   */
  reconcile(
    serverPos: Vec3,
    ackSeq: number,
    currentVel: Vec3,
    barriers: CircleObstacle[] = [],
  ): Vec3 {
    // Drop acknowledged inputs
    this.pending = this.pending.filter(i => i.seq > ackSeq);

    if (this.pending.length === 0) return serverPos;

    // Re-simulate unacknowledged inputs
    let pos = { ...serverPos };
    let vel = { ...currentVel };
    const dt = 1 / 64; // one tick

    for (const input of this.pending) {
      const result = this.predict(pos, vel, input.flags, input.yaw, dt, barriers);
      pos = result.pos;
      vel = result.vel;
    }

    return pos;
  }

  /** Blend between current visual position and corrected position. */
  static blendCorrection(visual: Vec3, corrected: Vec3, blendFactor = 0.3): Vec3 {
    const dx = corrected.x - visual.x;
    const dy = corrected.y - visual.y;
    const dz = corrected.z - visual.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Snap if too far off (teleport / extreme desync)
    if (dist > 5) return corrected;

    return {
      x: visual.x + dx * blendFactor,
      y: visual.y + dy * blendFactor,
      z: visual.z + dz * blendFactor,
    };
  }
}
