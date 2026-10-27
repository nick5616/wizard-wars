/**
 * Opt-in server health sampling (set WW_STATS=1, optionally WW_STATS_MS=5000).
 *
 * Every GameLoop tick reports how long the tick body took (`tickMs`) and how
 * long it has been since that room's previous tick started (`spacingMs`);
 * every WW_STATS_MS the window's p50/p95/max are printed as one parseable
 * `[stats] {json}` line together with heap/RSS and the sizes of every
 * per-room collection that could leak. scripts/playtest/soak.mjs reads these
 * lines when it spawns the server itself (--spawn), but they are just as
 * useful when watching a dev server by eye.
 *
 * When WW_STATS is unset, every hook is a single boolean check, so leaving
 * them in costs nothing.
 */
export const STATS_ENABLED = process.env.WW_STATS === '1';
const WINDOW_MS = parseInt(process.env.WW_STATS_MS ?? '5000', 10);

// A sample this long is not the game's doing on a shared dev box: whole-machine
// freezes of seconds were measured (an idle node canary reported ~4.5s stalls
// every ~9s). They are counted separately instead of poisoning the percentiles;
// the raw max is still reported alongside so a REAL long tick stays visible.
const STALL_MS = 250;

let tickMs = [];
let spacingMs = [];
let lagMs = [];
let stalls = 0;
let spinMs = 0;

/** Time spent busy-waiting in the tick scheduler's spin tail (the CPU price of precise tick spacing). */
export function recordSpin(ms) {
  if (STATS_ENABLED) spinMs += ms;
}
let rawMaxTick = 0;
let rawMaxSpacing = 0;

export function recordTick(durationMs, spacing) {
  if (!STATS_ENABLED) return;
  if (durationMs > rawMaxTick) rawMaxTick = durationMs;
  if (spacing > rawMaxSpacing) rawMaxSpacing = spacing;
  if (durationMs > STALL_MS || spacing > STALL_MS) { stalls++; return; }
  tickMs.push(durationMs);
  if (spacing > 0) spacingMs.push(spacing);
}

function pct(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(3);
}

const summarize = (arr) => ({ n: arr.length, p50: pct(arr, 0.5), p95: pct(arr, 0.95), p99: pct(arr, 0.99), max: +(arr.length ? Math.max(...arr) : 0).toFixed(3) });

export function startStats(server) {
  if (!STATS_ENABLED) return null;

  // Profiling aid: `WW_EXIT_AFTER_MS=40000 node --cpu-prof server/index.js` exits cleanly (flushing the .cpuprofile, which a killed process never does) after that long.
  if (process.env.WW_EXIT_AFTER_MS) setTimeout(() => process.exit(0), parseInt(process.env.WW_EXIT_AFTER_MS, 10)).unref();

  // Event-loop lag probe: a 10ms interval that should fire every 10ms; the
  // overshoot is how long other work (a long tick, a spinning room) held the loop.
  let expected = performance.now() + 10;
  const lagTimer = setInterval(() => {
    const now = performance.now();
    lagMs.push(Math.max(0, now - expected));
    expected = now + 10;
  }, 10);
  lagTimer.unref?.();

  let lastCpu = process.cpuUsage();
  let lastAt = performance.now();
  const timer = setInterval(() => {
    const mem = process.memoryUsage();
    // Process CPU over the window (user+system). Unlike per-tick wall time this
    // isn't inflated by the OS descheduling us on a busy dev box, and it is the
    // number that shows what busy-wait spinning actually costs.
    const cpu = process.cpuUsage(lastCpu);
    const lagFiltered = lagMs.filter((x) => x < STALL_MS);
    const nowT = performance.now();
    const windowMs = nowT - lastAt;
    const cpuPct = +(((cpu.user + cpu.system) / 1000) / (nowT - lastAt) * 100).toFixed(1);
    lastCpu = process.cpuUsage();
    lastAt = nowT;
    let players = 0, bots = 0, projectiles = 0, effects = 0, domains = 0, barriers = 0, snapshots = 0, pendingRespawns = 0, votes = 0;
    for (const room of server.rooms.values()) {
      projectiles += room.projectiles.size;
      effects += room.effects.size;
      domains += room.domains.size;
      barriers += room.barriers.size;
      snapshots += room.lagCompensation.snapshots.length;
      pendingRespawns += room._pendingRespawns.length;
      votes += room.progressionSystem.pendingVotes.size;
    }
    for (const p of server.players.values()) p.isBot ? bots++ : players++;
    const line = {
      t: Math.round(process.uptime()),
      rooms: server.rooms.size,
      players, bots,
      tickMs: summarize(tickMs),
      spacingMs: summarize(spacingMs),
      loopLagMs: summarize(lagFiltered),
      stalls, rawMaxTickMs: +rawMaxTick.toFixed(1), rawMaxSpacingMs: +rawMaxSpacing.toFixed(1),
      cpuPct,
      spinPct: +(spinMs / windowMs * 100).toFixed(1),
      heapMB: +(mem.heapUsed / 1048576).toFixed(1),
      rssMB: +(mem.rss / 1048576).toFixed(1),
      projectiles, effects, domains, barriers, snapshots, pendingRespawns, votes,
    };
    tickMs = []; spacingMs = []; lagMs = []; stalls = 0; spinMs = 0; rawMaxTick = 0; rawMaxSpacing = 0;
    console.log(`[stats] ${JSON.stringify(line)}`);
  }, WINDOW_MS);
  timer.unref?.();
  return () => { clearInterval(timer); clearInterval(lagTimer); };
}
