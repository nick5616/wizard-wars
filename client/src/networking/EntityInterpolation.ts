/**
 * Interpolates remote player positions.
 *
 * Keeps a time-stamped buffer of server-reported positions and renders each
 * remote a little in the past, smoothly lerping between the two samples that
 * straddle that moment.
 *
 * Three things keep it smooth across network conditions (they used to be a
 * fixed 100ms delay against an NTP-estimated server clock):
 *  - The render clock is derived from the ticks themselves: the fastest recent
 *    (arrival time - server timestamp) is the baseline "one-way lag", so the
 *    clock does not wobble with the asymmetric/jittery ping samples ClockSync
 *    uses, and it self-heals after a path change.
 *  - The delay adapts to measured arrival jitter (p95 of how late ticks arrive
 *    relative to that baseline), so a clean link renders ~30ms behind instead
 *    of 100ms and a bad one grows the buffer instead of starving it.
 *  - When the buffer does run dry it dead-reckons forward with a decaying
 *    velocity, and any positional jump that follows (the late packet landing,
 *    or a correction after extrapolation) is eased out instead of snapped.
 *    Real teleports (dashes, respawns) are detected per sample and cut
 *    instead of being lerped across the map.
 */

import { PLAYER_HEIGHT } from 'shared/constants';
import { terrainHeightAt } from 'shared/mapLayout';
import type { Vec3, PlayerState } from '../types/game.types';
import { netDebug } from './netDebug';

const TICK_MS = 1000 / 64;

// Render-delay bounds. Floor: need two samples around the render time even on
// a perfect link. Ceiling: past this the remote feels too far in the past to
// shoot at, so extrapolation covers the rest.
const MIN_DELAY_MS = 32;
const MAX_DELAY_MS = 260;

// How far past the newest known sample we'll dead-reckon a remote player
// forward (using their recent velocity) instead of freezing them in place.
// Masks a WebSocket head-of-line stall/late tick without letting a real
// lag-out or disconnect walk the player through a wall for an unbounded
// amount of time -- past this, fall back to freezing.
const MAX_EXTRAPOLATION_MS = 250;

// One-tick displacement above this is a teleport (dash/blink/respawn), not
// motion: the fastest legit movement is well under 1 unit per tick.
const TELEPORT_DIST = 2.5;

// Time constant for easing out discontinuities in the rendered position.
const SMOOTH_TAU_MS = 70;

const DEV_WINDOW = 256; // arrival-jitter samples (4s of ticks)
const LAG_BUCKET_MS = 1000;
const LAG_BUCKETS = 8;

interface Sample {
  timestamp: number; // server time
  position: Vec3;
  yaw: number;
  pitch: number;
  health: number;
  isAlive: boolean;
  isChoosingBranch: boolean;
  teleport?: boolean; // position discontinuity relative to the previous sample
}

interface Smoothing {
  lastTarget: Vec3 | null;
  offset: Vec3; // displayed - target, decays to zero
  lastAt: number; // performance.now() of the previous frame
}

export class EntityInterpolation {
  private buffers = new Map<string, Sample[]>(); // playerId → samples
  private smoothing = new Map<string, Smoothing>();

  // Render clock + adaptive delay (see header).
  private lagBuckets: number[] = [];
  private bucketStart = 0;
  private baseLag: number | null = null;
  private devs: number[] = [];
  private ticksSinceDelay = 0;
  private _delay = 60;

  /** Dev: baseline lag and arrival-lateness percentiles over the jitter window. */
  debugArrival() {
    const sorted = [...this.devs].sort((x, y) => x - y);
    const pick = (q: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0;
    return { baseLag: this.baseLag, p50: pick(0.5), p95: pick(0.95), max: pick(1), delay: this._delay, n: sorted.length };
  }

  get delay() { return this._delay; }

  /**
   * Call once per received GAME_TICK with its server timestamp: feeds the
   * baseline-lag estimate and the arrival-jitter-driven delay.
   */
  onTick(serverTimestamp: number) {
    // Dev-only handle for the Playwright harness (arrival-jitter inspection).
    if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __interp: EntityInterpolation }).__interp = this;
    const nowMs = Date.now();
    const lag = nowMs - serverTimestamp;

    // Windowed minimum in coarse buckets (cheap, forgets old paths after ~8s).
    if (this.lagBuckets.length === 0 || nowMs - this.bucketStart >= LAG_BUCKET_MS) {
      this.lagBuckets.push(lag);
      if (this.lagBuckets.length > LAG_BUCKETS) this.lagBuckets.shift();
      this.bucketStart = nowMs;
    } else if (lag < this.lagBuckets[this.lagBuckets.length - 1]) {
      this.lagBuckets[this.lagBuckets.length - 1] = lag;
    }
    this.baseLag = Math.min(...this.lagBuckets);

    this.devs.push(Math.max(0, lag - this.baseLag));
    if (this.devs.length > DEV_WINDOW) this.devs.shift();

    if (++this.ticksSinceDelay >= 8 && this.devs.length >= 16) {
      this.ticksSinceDelay = 0;
      const sorted = [...this.devs].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const target = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, p95 + TICK_MS * 1.5));
      // Grow quickly (starvation hurts more), shrink slowly (speed change of
      // the playback clock stays imperceptible).
      this._delay += (target - this._delay) * (target > this._delay ? 0.25 : 0.04);
    }
  }

  /** Server-clock time currently being rendered. */
  renderTime(): number {
    return Date.now() - (this.baseLag ?? 0) - this._delay;
  }

  /** Record a new authoritative sample for a remote player. */
  record(playerId: string, serverTimestamp: number, state: PlayerState) {
    if (!this.buffers.has(playerId)) this.buffers.set(playerId, []);
    const buf = this.buffers.get(playerId)!;
    const prev = buf.length > 0 ? buf[buf.length - 1] : null;
    let teleport = false;
    if (prev) {
      const dx = state.position.x - prev.position.x, dz = state.position.z - prev.position.z;
      const dy = state.position.y - prev.position.y;
      teleport = dx * dx + dz * dz + dy * dy > TELEPORT_DIST * TELEPORT_DIST
        || (state.isAlive && !prev.isAlive);
    }
    buf.push({
      timestamp: serverTimestamp,
      position: { ...state.position },
      yaw: state.yaw,
      pitch: state.pitch,
      health: state.health,
      isAlive: state.isAlive,
      isChoosingBranch: !!state.isChoosingBranch,
      teleport,
    });
    // Keep last 90 samples (~1.4s at 64Hz)
    if (buf.length > 90) buf.shift();
  }

  /** Get interpolated state for a remote player at the current render time. */
  getInterpolated(playerId: string): Sample | null {
    const buf = this.buffers.get(playerId);
    if (!buf || buf.length === 0) return null;

    const renderTime = this.renderTime();
    const raw = this.sampleAt(buf, renderTime);
    return this.smooth(playerId, raw);
  }

  private sampleAt(buf: Sample[], renderTime: number): Sample {
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

    if (!before) { netDebug.onInterpFrame('starved', this._delay); return buf[0]; } // too early -- use oldest

    if (!after) {
      // No newer sample yet -- the packet carrying the next position is late.
      // Dead-reckon forward from recent samples' velocity (spanning a few
      // ticks so per-tick timestamp jitter doesn't dominate the estimate)
      // instead of freezing, easing the speed to zero at the extrapolation
      // limit so it never overshoots abruptly.
      const overdue = renderTime - before.timestamp;
      const refIdx = Math.max(0, buf.length - 4);
      const ref = buf[refIdx];
      const dtSample = before.timestamp - ref.timestamp;
      if (ref !== before && dtSample > 0 && overdue > 0.5 && overdue <= MAX_EXTRAPOLATION_MS) {
        const travel = overdue - (overdue * overdue) / (2 * MAX_EXTRAPOLATION_MS);
        const k = travel / dtSample;
        const x = before.position.x + (before.position.x - ref.position.x) * k;
        const z = before.position.z + (before.position.z - ref.position.z) * k;
        // Never extrapolate below the floor (a falling player would otherwise sink into it).
        const floorY = PLAYER_HEIGHT + terrainHeightAt(x, z);
        const y = Math.max(floorY, before.position.y + (before.position.y - ref.position.y) * k);
        netDebug.onInterpFrame('extrapolating', this._delay);
        return {
          timestamp: renderTime,
          position: { x, y, z },
          yaw: before.yaw,
          pitch: before.pitch,
          health: before.health,
          isAlive: before.isAlive,
          isChoosingBranch: before.isChoosingBranch,
        };
      }
      netDebug.onInterpFrame(overdue > MAX_EXTRAPOLATION_MS ? 'starved' : 'ok', this._delay);
      return before; // exact match, or too far overdue -- freeze in place
    }

    const t = (renderTime - before.timestamp) / (after.timestamp - before.timestamp);
    const clampedT = Math.max(0, Math.min(1, t));

    // A teleport sample (dash, respawn) is a cut: hold the old spot until the
    // render clock reaches it, then show the new one -- never lerp across the map.
    const position = after.teleport ? (clampedT >= 1 ? after.position : before.position) : lerpVec3(before.position, after.position, clampedT);
    netDebug.onInterpFrame(after.teleport ? 'teleport' : 'ok', this._delay);

    return {
      timestamp: renderTime,
      position,
      yaw: lerpAngle(before.yaw, after.yaw, clampedT),
      pitch: lerp(before.pitch, after.pitch, clampedT),
      health: lerp(before.health, after.health, clampedT),
      isAlive: before.isAlive,
      isChoosingBranch: before.isChoosingBranch,
    };
  }

  /**
   * Eases out position discontinuities (extrapolation hand-back, a late
   * packet, a stall recovering) without adding steady-state lag: the offset
   * is measured against the target's *previous* position, so smooth motion
   * leaves it at zero and only jumps decay.
   */
  private smooth(playerId: string, s: Sample): Sample {
    const nowMs = performance.now();
    let st = this.smoothing.get(playerId);
    if (!st) {
      st = { lastTarget: null, offset: { x: 0, y: 0, z: 0 }, lastAt: nowMs };
      this.smoothing.set(playerId, st);
    }
    const dt = Math.min(250, nowMs - st.lastAt);
    st.lastAt = nowMs;

    if (st.lastTarget) {
      const jx = s.position.x - st.lastTarget.x, jy = s.position.y - st.lastTarget.y, jz = s.position.z - st.lastTarget.z;
      const jump2 = jx * jx + jy * jy + jz * jz;
      // Per-frame displacement beyond what motion plausibly covers (frame
      // time * 40 u/s, plus slack) is a discontinuity: ease it, unless it is
      // so large it must be a teleport.
      const plausible = (dt / 1000) * 40 + 0.15;
      if (jump2 > TELEPORT_DIST * TELEPORT_DIST) {
        st.offset = { x: 0, y: 0, z: 0 };
      } else if (jump2 > plausible * plausible) {
        const m = Math.sqrt(jump2);
        const excess = (m - plausible) / m;
        st.offset.x -= jx * excess; st.offset.y -= jy * excess; st.offset.z -= jz * excess;
      }
    }
    st.lastTarget = { ...s.position };

    const decay = Math.exp(-dt / SMOOTH_TAU_MS);
    st.offset.x *= decay; st.offset.y *= decay; st.offset.z *= decay;

    return {
      ...s,
      position: {
        x: s.position.x + st.offset.x,
        y: s.position.y + st.offset.y,
        z: s.position.z + st.offset.z,
      },
    };
  }

  removePlayer(playerId: string) {
    this.buffers.delete(playerId);
    this.smoothing.delete(playerId);
  }

  /** Forget everything (reconnect: the old timeline and clock baseline no longer apply). */
  clear() {
    this.buffers.clear();
    this.smoothing.clear();
    this.lagBuckets = [];
    this.baseLag = null;
    this.devs = [];
    this.ticksSinceDelay = 0;
    this._delay = 60;
  }

  /** Clean up buffers for players no longer in the game. */
  prune(activeIds: Set<string>) {
    for (const id of this.buffers.keys()) {
      if (!activeIds.has(id)) this.removePlayer(id);
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
