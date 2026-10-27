import { recordTick, recordSpin } from './stats.js';

/**
 * Fixed-rate game loops targeting a given Hz rate, all driven by ONE shared
 * scheduler.
 *
 * Plain `setTimeout(fn, delay)` is subject to OS timer-resolution rounding
 * (can be as coarse as ~15ms on Windows), which at a 64Hz (~15.6ms) tick
 * rate produces visibly uneven real-world tick spacing -- ticks firing
 * back-to-back or skipping a beat. That unevenness feeds straight through to
 * GAME_TICK broadcast timestamps (client jitter stat, remote-entity
 * interpolation). To get much tighter spacing without depending on
 * OS-specific timer tricks, each wait is split into a coarse `setTimeout`
 * for most of the remaining time and a short busy-wait tail (checking
 * performance.now()) for the last millisecond or two.
 *
 * Why shared: this used to be one setTimeout + one spin per Room. K rooms
 * each spun their own last ~2ms of every 15.6ms tick at an unrelated phase,
 * so K=8 rooms burned most of a core in pure spinning and the spins queued
 * in front of each other (and in front of every WebSocket read), adding
 * jitter instead of removing it. Now every loop of the same rate is aligned
 * to a single global tick grid: one wake-up, one spin, then every due loop
 * runs back-to-back. Spin cost no longer scales with room count, and a
 * server with no running loops schedules nothing at all.
 */
// Windows timers wake up on ~15.6ms boundaries unless something raises the
// system timer resolution, so it needs a generous spin tail. Elsewhere
// setTimeout is accurate to about a millisecond.
const SPIN_THRESHOLD_MS = parseFloat(process.env.WW_SPIN_MS ?? (process.platform === 'win32' ? '2' : '1'));
const MAX_CATCHUP_TICKS = 4; // per wake-up, per loop: bounded so a stall can't snowball into a death spiral
const DUE_SLOP_MS = 0.25; // a loop due within this much of "now" runs now instead of costing another wake-up + spin

class Scheduler {
  constructor() {
    this.loops = new Set();
    this.timer = null;
    this.gridOrigin = performance.now();
  }

  add(loop) {
    // Snap the first deadline onto the shared grid (next boundary strictly in
    // the future) so loops created at different moments still tick together.
    this.snap(loop);
    this.loops.add(loop);
    // A new loop may be due before the currently armed wake-up.
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this._arm();
  }

  /** Moves `loop`'s deadline to the first grid boundary strictly after now. */
  snap(loop) {
    const n = Math.floor((performance.now() - this.gridOrigin) / loop.interval) + 1;
    loop._due = this.gridOrigin + n * loop.interval;
  }

  remove(loop) {
    this.loops.delete(loop);
    if (this.loops.size === 0 && this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  _earliestDue() {
    let min = Infinity;
    for (const l of this.loops) if (l._due < min) min = l._due;
    return min;
  }

  _arm() {
    if (this.timer || this.loops.size === 0) return;
    const delay = Math.max(0, this._earliestDue() - performance.now() - SPIN_THRESHOLD_MS);
    this.timer = setTimeout(() => { this.timer = null; this._wake(); }, delay);
  }

  _wake() {
    if (this.loops.size > 0) {
      // Busy-wait the last sliver for sub-millisecond precision.
      const deadline = this._earliestDue();
      const spinStart = performance.now();
      while (performance.now() < deadline) { /* spin */ }
      recordSpin(performance.now() - spinStart);

      const now = performance.now();
      for (const loop of [...this.loops]) {
        if (!loop._running || loop._due - now > DUE_SLOP_MS) continue;
        loop._runDue(now);
      }
    }
    this._arm();
  }
}

const scheduler = new Scheduler();

export class GameLoop {
  constructor(hz, onTick) {
    this.interval = 1000 / hz;
    this.onTick = onTick;
    this._running = false;
    this._due = 0;
    this._lastTickStart = 0;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTickStart = 0;
    scheduler.add(this);
  }

  stop() {
    this._running = false;
    scheduler.remove(this);
  }

  /** Runs this loop's due tick(s); catch up if behind, but cap to avoid a spiral. */
  _runDue(now) {
    let iterations = 0;
    while (this._running && this._due - now <= DUE_SLOP_MS && iterations < MAX_CATCHUP_TICKS) {
      this._due += this.interval;
      const t0 = performance.now();
      try {
        this.onTick();
      } catch (e) {
        console.error('[GameLoop] Tick error:', e);
      }
      now = performance.now();
      recordTick(now - t0, this._lastTickStart ? t0 - this._lastTickStart : 0);
      this._lastTickStart = t0;
      iterations++;
    }
    // Still behind after the catch-up budget: drop the remaining debt instead
    // of carrying it forward (the old accumulator never forgave it, so one
    // long stall caused a long run of back-to-back "catch-up" ticks that
    // distorted tick spacing for every client).
    if (this._running && this._due < now) scheduler.snap(this);
  }
}
