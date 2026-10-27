/**
 * NTP-style clock synchronization.
 * Maintains an estimated offset between local clock and server clock.
 * All input events are timestamped with serverNow() before sending.
 *
 * Under jitter the symmetric-path assumption behind `offset` breaks per
 * sample: a ping that happened to queue on the way out reads as a large bogus
 * offset. The classic fix (used here) is to trust the sample with the lowest
 * RTT in the recent window -- the least-queued one -- rather than a median of
 * everything, and to slew the published offset toward it so serverNow() never
 * jumps backwards/forwards by tens of ms between two calls (lag-compensated
 * casts are stamped with it).
 */

import { MAX_CLOCK_SAMPLES } from 'shared/constants';
import { netDebug } from './netDebug';

// Offset changes smaller than this are slewed in at MAX_SLEW_MS per sample;
// larger ones (first sync, a real clock step) are applied at once.
const SLEW_LIMIT_MS = 50;
const MAX_SLEW_MS = 3;

interface ClockSample { offset: number; rtt: number; }

export class ClockSync {
  private samples: ClockSample[] = [];
  private _offset = 0;
  private _rtt = 100;
  private synced = false;

  get offset() { return this._offset; }
  get rtt() { return this._rtt; }
  get isSynced() { return this.synced; }

  serverNow() {
    return Date.now() + this._offset;
  }

  /** Forget all samples (reconnect: new socket, possibly different path/server process). */
  reset() {
    this.samples = [];
    this.synced = false;
  }

  /** Call when a CLOCK_SYNC response arrives: { t1, t2, t3 } */
  onResponse(t1: number, t2: number, t3: number) {
    const t4 = Date.now();
    const rtt = t4 - t1;
    const offset = ((t2 - t1) + (t3 - t4)) / 2;

    this._rtt = rtt;
    this.samples.push({ offset, rtt });
    if (this.samples.length > MAX_CLOCK_SAMPLES) this.samples.shift();

    // Lowest-RTT sample in the window is the best offset estimate.
    let best = this.samples[0];
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;

    const diff = best.offset - this._offset;
    if (!this.synced || Math.abs(diff) > SLEW_LIMIT_MS) {
      this._offset = best.offset;
      this.synced = true;
    } else {
      this._offset += Math.max(-MAX_SLEW_MS, Math.min(MAX_SLEW_MS, diff));
    }
    netDebug.onClock(this._offset, rtt);
  }
}
