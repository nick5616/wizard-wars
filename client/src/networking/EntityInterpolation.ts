/**
 * Interpolates remote player positions.
 * Keeps a time-stamped buffer of server-reported positions and renders
 * at (serverNow - INTERPOLATION_DELAY), smoothly lerping between samples.
 */

import { INTERPOLATION_DELAY } from 'shared/constants';
import type { Vec3, PlayerState } from '../types/game.types';

interface Sample {
  timestamp: number; // server time
  position: Vec3;
  yaw: number;
  pitch: number;
  health: number;
  isAlive: boolean;
  isChoosingBranch: boolean;
}

export class EntityInterpolation {
  private buffers = new Map<string, Sample[]>(); // playerId → samples

  /** Record a new authoritative sample for a remote player. */
  record(playerId: string, serverTimestamp: number, state: PlayerState) {
    if (!this.buffers.has(playerId)) this.buffers.set(playerId, []);
    const buf = this.buffers.get(playerId)!;
    buf.push({
      timestamp: serverTimestamp,
      position: { ...state.position },
      yaw: state.yaw,
      pitch: state.pitch,
      health: state.health,
      isAlive: state.isAlive,
      isChoosingBranch: !!state.isChoosingBranch,
    });
    // Keep last 60 samples (~1s at 64Hz)
    if (buf.length > 60) buf.shift();
  }

  /** Get interpolated state for a player at renderTime (server time - delay). */
  getInterpolated(playerId: string, serverNow: number): Sample | null {
    const buf = this.buffers.get(playerId);
    if (!buf || buf.length === 0) return null;

    const renderTime = serverNow - INTERPOLATION_DELAY;

    // Find the two samples that straddle renderTime
    let before: Sample | null = null;
    let after: Sample | null = null;

    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].timestamp <= renderTime) {
        before = buf[i];
        after = buf[i + 1] ?? null;
        break;
      }
    }

    if (!before) return buf[0]; // too early — use oldest
    if (!after) return before;  // too late or exact match

    const t = (renderTime - before.timestamp) / (after.timestamp - before.timestamp);
    const clampedT = Math.max(0, Math.min(1, t));

    return {
      timestamp: renderTime,
      position: lerpVec3(before.position, after.position, clampedT),
      yaw: lerpAngle(before.yaw, after.yaw, clampedT),
      pitch: lerp(before.pitch, after.pitch, clampedT),
      health: lerp(before.health, after.health, clampedT),
      isAlive: before.isAlive,
      isChoosingBranch: before.isChoosingBranch,
    };
  }

  removePlayer(playerId: string) {
    this.buffers.delete(playerId);
  }

  /** Clean up buffers for players no longer in the game. */
  prune(activeIds: Set<string>) {
    for (const id of this.buffers.keys()) {
      if (!activeIds.has(id)) this.buffers.delete(id);
    }
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

function lerpAngle(a: number, b: number, t: number) {
  let diff = b - a;
  // Wrap around
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
