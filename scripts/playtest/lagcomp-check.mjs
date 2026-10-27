#!/usr/bin/env node
/**
 * Unit check for server/src/systems/LagCompensation.js rewind bounds.
 *   node scripts/playtest/lagcomp-check.mjs
 *
 * Builds 32 snapshots of a target running +X at 8 u/s (one per 15.625ms, like
 * the real room), then asks rayCast to resolve a shot whose client timestamp
 * claims to be 50ms / 250ms / 2s / 1e9ms old, a future timestamp, NaN and
 * Infinity -- and reports how far back the server actually rewound.
 */
import { LagCompensation, MAX_REWIND_MS } from '../../server/src/systems/LagCompensation.js';
import { STATE_HISTORY_TICKS } from '../../shared/constants.js';

const lc = new LagCompensation(STATE_HISTORY_TICKS);
const T0 = 1_000_000;
const NOW = T0 + (STATE_HISTORY_TICKS - 1) * 15.625;
for (let i = 0; i < STATE_HISTORY_TICKS; i++) {
  const t = T0 + i * 15.625;
  lc.save(i, t, { players: { target: { position: { x: (t - T0) / 1000 * 8, y: 1.8, z: 0 }, isAlive: true, level: 1 } }, projectiles: {} });
}
let ok = true;
for (const [label, ts] of [['50ms old', NOW - 50], ['250ms old', NOW - 250], ['400ms old', NOW - 400], ['2s old', NOW - 2000], ['1e9ms old', NOW - 1e9], ['future', NOW + 5000], ['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity]]) {
  const snap = lc.getSnapshotAt(ts);
  const rewound = NOW - snap.timestamp;
  const bounded = rewound <= MAX_REWIND_MS + 16 && rewound >= -1;
  if (!bounded) ok = false;
  console.log(`${label.padEnd(10)} -> rewound ${rewound.toFixed(1).padStart(7)}ms  ${bounded ? 'ok' : 'UNBOUNDED'}`);
}
console.log(ok ? `rewind capped at ${MAX_REWIND_MS}ms` : 'FAIL');
process.exit(ok ? 0 : 1);
