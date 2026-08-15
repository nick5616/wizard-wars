import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const WORKER_PATH = fileURLToPath(new URL('./simWorker.js', import.meta.url));
const MAX_CONCURRENT = 3;

/** Small worker pool for headless tournament simulations — each run gets its own isolated worker/fake clock, queued if the pool is full. */
export class SimulationRunner {
  constructor() {
    this.queue = [];
    this.active = 0;
  }

  run({ matchup, rounds }, onProgress) {
    return new Promise((resolve, reject) => {
      const task = () => {
        const worker = new Worker(WORKER_PATH, { type: 'module' });
        let settled = false;

        worker.on('message', (msg) => {
          if (msg.type === 'progress') {
            onProgress?.(msg.completed, msg.total);
          } else if (msg.type === 'result') {
            settled = true;
            worker.terminate();
            this._onTaskDone();
            resolve(msg);
          }
        });

        worker.on('error', (err) => {
          if (settled) return;
          settled = true;
          this._onTaskDone();
          reject(err);
        });

        worker.postMessage({ type: 'run', matchup, rounds });
      };

      this.queue.push(task);
      this._pump();
    });
  }

  _pump() {
    while (this.active < MAX_CONCURRENT && this.queue.length > 0) {
      this.active++;
      const task = this.queue.shift();
      task();
    }
  }

  _onTaskDone() {
    this.active--;
    this._pump();
  }
}

export const simulationRunner = new SimulationRunner();
