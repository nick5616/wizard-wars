/**
 * Fixed-rate game loop using setImmediate for tight timing on Node.js.
 * Targets the given Hz rate; drifts are accumulated and caught up.
 */
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
    // Use setImmediate to yield, then check if enough time has passed
    this._handle = setTimeout(() => this._tick(), 0);
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
    const delay = Math.max(0, this.interval - this._accumulated);
    this._handle = setTimeout(() => this._tick(), delay);
  }
}
