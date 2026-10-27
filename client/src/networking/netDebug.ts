/**
 * Dev-only netcode instrumentation (compiled to no-ops in production builds).
 *
 * Collects, per rendered frame / server tick:
 *  - reconciliation correction magnitude (predicted position vs. the
 *    server-reconciled one) and the unacked input count behind it,
 *  - remote interpolation health (extrapolating / starved / teleport frames,
 *    current adaptive delay),
 *  - clock offset samples,
 * and surfaces them in the net-graph (NetworkStats) and as `window.__netdbg`
 * for the Playwright harness (summary(), reset(), remote position traces,
 * yaw override for scripted driving).
 */

const ENABLED = import.meta.env.DEV;

const WINDOW_MS = 5000;
const SNAP_THRESHOLD = 0.05; // a correction above 5cm is "visible"

interface CorrectionSample { t: number; mag: number; unacked: number; ackErr: number; }

export interface NetDebugLive {
  corrMean: number;
  corrP95: number;
  corrPerSec: number;
  unacked: number;
  interpDelay: number;
  extrapPct: number;
  starvedPct: number;
}

const live: NetDebugLive = { corrMean: 0, corrP95: 0, corrPerSec: 0, unacked: 0, interpDelay: 0, extrapPct: 0, starvedPct: 0 };

let corrections: CorrectionSample[] = [];
let allCorrections: CorrectionSample[] = [];
let ticks = 0;
let interpFrames = 0, extrapFrames = 0, starvedFrames = 0, teleportFrames = 0;
let interpDelay = 0;
let offsets: { t: number; offset: number; rtt: number }[] = [];
let remoteTrace: { t: number; id: string; x: number; y: number; z: number }[] = [];
let tracing = false;
let startedAt = performance.now();

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function refreshLive(now: number) {
  while (corrections.length > 0 && now - corrections[0].t > WINDOW_MS) corrections.shift();
  const mags = corrections.map((c) => c.mag).sort((a, b) => a - b);
  live.corrMean = mags.length ? mags.reduce((a, b) => a + b, 0) / mags.length : 0;
  live.corrP95 = percentile(mags, 0.95);
  live.corrPerSec = mags.filter((m) => m > SNAP_THRESHOLD).length / (WINDOW_MS / 1000);
  live.unacked = corrections.length ? corrections[corrections.length - 1].unacked : 0;
  live.interpDelay = interpDelay;
  live.extrapPct = interpFrames ? (100 * extrapFrames) / interpFrames : 0;
  live.starvedPct = interpFrames ? (100 * starvedFrames) / interpFrames : 0;
}

export const netDebug = {
  enabled: ENABLED,
  live,
  /** Harness hook: when non-null, CameraController uses this yaw instead of mouse look. */
  lastAckErr: 0,
  yawOverride: null as number | null,
  /** Harness hook: latest local predicted state, written by CameraController. */
  local: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },

  /** A reconcile result was applied; `mag` is the distance (world units) the prediction moved by. */
  onCorrection(mag: number, unacked: number) {
    if (!ENABLED) return;
    const s = { t: performance.now(), mag, unacked, ackErr: netDebug.lastAckErr };
    corrections.push(s);
    allCorrections.push(s);
    if (allCorrections.length > 200000) allCorrections = allCorrections.slice(-100000);
    refreshLive(s.t);
  },

  onTick() {
    if (!ENABLED) return;
    ticks++;
  },

  /** One remote-player interpolation frame: 'ok' | 'extrapolating' | 'starved' (buffer ran dry past the extrapolation limit). */
  onInterpFrame(kind: 'ok' | 'extrapolating' | 'starved' | 'teleport', delayMs: number) {
    if (!ENABLED) return;
    interpFrames++;
    if (kind === 'extrapolating') extrapFrames++;
    else if (kind === 'starved') starvedFrames++;
    else if (kind === 'teleport') teleportFrames++;
    interpDelay = delayMs;
  },

  onClock(offset: number, rtt: number) {
    if (!ENABLED) return;
    offsets.push({ t: performance.now(), offset, rtt });
  },

  traceRemote(id: string, x: number, y: number, z: number) {
    if (!ENABLED || !tracing) return;
    remoteTrace.push({ t: performance.now(), id, x, y, z });
  },

  reset() {
    corrections = [];
    allCorrections = [];
    ticks = 0;
    interpFrames = extrapFrames = starvedFrames = teleportFrames = 0;
    offsets = [];
    remoteTrace = [];
    startedAt = performance.now();
  },

  summary() {
    const mags = allCorrections.map((c) => c.mag).sort((a, b) => a - b);
    const secs = (performance.now() - startedAt) / 1000;
    const unackedMean = allCorrections.length ? allCorrections.reduce((a, c) => a + c.unacked, 0) / allCorrections.length : 0;
    const offs = offsets.map((o) => o.offset);
    const offMean = offs.length ? offs.reduce((a, b) => a + b, 0) / offs.length : 0;
    const offStd = offs.length ? Math.sqrt(offs.reduce((a, b) => a + (b - offMean) ** 2, 0) / offs.length) : 0;
    return {
      seconds: secs,
      corrections: mags.length,
      meanMag: mags.length ? mags.reduce((a, b) => a + b, 0) / mags.length : 0,
      p95Mag: percentile(mags, 0.95),
      maxMag: mags.length ? mags[mags.length - 1] : 0,
      over5cm: mags.filter((m) => m > SNAP_THRESHOLD).length,
      over5cmPerSec: mags.filter((m) => m > SNAP_THRESHOLD).length / Math.max(secs, 1e-3),
      over50cm: mags.filter((m) => m > 0.5).length,
      unackedMean,
      ticks,
      interpFrames, extrapFrames, starvedFrames, teleportFrames,
      interpDelay,
      clockSamples: offs.length, clockOffsetMean: offMean, clockOffsetStd: offStd,
    };
  },

  rawCorrections() { return allCorrections.filter((c) => c.mag > SNAP_THRESHOLD).map((c) => [Math.round(c.t - startedAt), +c.mag.toFixed(3), c.unacked, +c.ackErr.toFixed(3)]); },

  startTrace() { tracing = true; remoteTrace = []; },
  stopTrace() { tracing = false; return remoteTrace; },
};

if (ENABLED && typeof window !== 'undefined') {
  (window as unknown as { __netdbg: typeof netDebug }).__netdbg = netDebug;
}
