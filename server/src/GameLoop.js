/**
 * Fixed-rate game loop targeting the given Hz rate; drifts are accumulated
 * and caught up.
 *
 * Plain `setTimeout(fn, delay)` is subject to OS timer-resolution rounding
 * (can be as coarse as ~15ms), which at a 64Hz (~15.6ms) tick rate produces
 * visibly uneven real-world tick spacing -- ticks firing back-to-back or
 * skipping a beat. That unevenness feeds straight through to GAME_TICK
 * broadcast timestamps (client jitter stat, remote-entity interpolation).
 * To get much tighter spacing without depending on OS-specific timer
 * tricks, each wait is split into a coarse `setTimeout` for most of the
 * remaining time and a short busy-wait tail (checking performance.now())
 * for the last couple of milliseconds.
 */
const SPIN_THRESHOLD_MS = 2; // switch from setTimeout to a busy-wait once this close to the deadline

export class GameLoop {
  constructor(hz, onTick) {
    this.interval = 1000 / hz;
    this.onTick = onTick;
    this._running = false;
    this._lastTime = 0;
    this._accumulated = 0;
    this._handle = null;
  }

  start() {
    this._running = true;
    this._lastTime = performance.now();
    this._schedule();
  }

  stop() {
    this._running = false;
    if (this._handle) {
      clearTimeout(this._handle);
      this._handle = null;
    }
  }

  _schedule() {
    if (!this._running) return;
    const remaining = this.interval - this._accumulated;
    const delay = Math.max(0, remaining - SPIN_THRESHOLD_MS);
    this._handle = setTimeout(() => this._waitAndTick(), delay);
  }

  /** Busy-wait the last sliver of the interval for sub-millisecond precision, then tick. */
  _waitAndTick() {
    if (!this._running) return;
    const deadline = this._lastTime + this.interval - this._accumulated;
    while (performance.now() < deadline) { /* spin */ }
    this._tick();
  }

  _tick() {
    if (!this._running) return;

    const now = performance.now();
    const elapsed = now - this._lastTime;
    this._lastTime = now;
    this._accumulated += elapsed;

    // Run as many ticks as we've accumulated (catch up if behind, but cap to avoid spiral)
    let iterations = 0;
    while (this._accumulated >= this.interval && iterations < 4) {
      this._accumulated -= this.interval;
      try {
        this.onTick();
      } catch (e) {
        console.error('[GameLoop] Tick error:', e);
      }
      iterations++;
    }

    // Schedule next tick
    this._schedule();
  }
}
