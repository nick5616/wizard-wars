/**
 * NTP-style clock synchronization.
 * Maintains an estimated offset between local clock and server clock.
 * All input events are timestamped with serverNow() before sending.
 */

import { MAX_CLOCK_SAMPLES } from 'shared/constants';

export class ClockSync {
  private offsets: number[] = [];
  private _offset = 0;
  private _rtt = 100;

  get offset() { return this._offset; }
  get rtt() { return this._rtt; }

  serverNow() {
    return Date.now() + this._offset;
  }

  /** Call when a CLOCK_SYNC response arrives: { t1, t2, t3 } */
  onResponse(t1: number, t2: number, t3: number) {
    const t4 = Date.now();
    const rtt = t4 - t1;
    const offset = ((t2 - t1) + (t3 - t4)) / 2;

    this._rtt = rtt;
    this.offsets.push(offset);
    if (this.offsets.length > MAX_CLOCK_SAMPLES) this.offsets.shift();

    // Use median to reject outliers
    const sorted = [...this.offsets].sort((a, b) => a - b);
    this._offset = sorted[Math.floor(sorted.length / 2)];
  }
}
