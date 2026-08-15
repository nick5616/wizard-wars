/**
 * Headless fast-forward match simulator, run inside a worker_thread.
 *
 * The trick: Room/Player/SpellSystem/ProgressionSystem all call Date.now()
 * directly (cooldowns, effect expiry, lag-comp snapshots, ...) — so instead
 * of threading a clock through every one of those ~40 call sites (touching
 * live combat code for a debug feature's sake), we monkey-patch Date.now
 * itself to a fake, rapidly-advancing clock. Worker threads have their own
 * global scope, so this can never leak into the real server process — only
 * this worker's Date is fake. See the room's GameLoop (setTimeout-paced) is
 * simply never started; we call room.update() directly in a tight loop.
 */
import { parentPort } from 'node:worker_threads';
import { Room } from '../Room.js';
import { TICK_RATE } from 'shared/constants';

const TICK_INTERVAL_MS = 1000 / TICK_RATE;
const MAX_ROUND_SECONDS = 90; // safety cap — a round that runs this long without a death is a draw

let fakeNow = Date.now();
Date.now = () => fakeNow;

function buildStandInServer() {
  // Room/SpellSystem reach through room.server.players.get(...) everywhere;
  // send/broadcast are no-ops since sim bots have no real ws to notify.
  return { players: new Map(), rooms: new Map(), send() {}, broadcast() {} };
}

/** Runs one 1v1 round to a death (or the safety cap). Returns round stats. */
function runRound(matchup) {
  const server = buildStandInServer();
  const room = new Room({ id: 'sim', server, respawnEnabled: false });

  const positions = [{ x: -12, y: 1.8, z: 0 }, { x: 12, y: 1.8, z: 0 }];
  const bots = matchup.map((side, i) => room.spawnBot({
    class: side.class,
    behavior: 'aggressive',
    position: positions[i],
    loadout: side.loadout ?? null,
  }));

  const startedAt = fakeNow;
  const maxTicks = Math.ceil(MAX_ROUND_SECONDS * TICK_RATE);
  let winnerIndex = null;

  for (let tick = 0; tick < maxTicks; tick++) {
    fakeNow += TICK_INTERVAL_MS;
    room.update();

    const deadIndex = bots.findIndex((b) => !b.isAlive);
    if (deadIndex !== -1) {
      winnerIndex = deadIndex === 0 ? 1 : 0;
      break;
    }
  }

  const timeToKillMs = fakeNow - startedAt;
  const damageBySpell = {};
  for (const [spellId, entry] of room.damageLog) damageBySpell[spellId] = { ...entry };

  return {
    winnerIndex, // 0, 1, or null (draw / safety cap hit) -- the only unambiguous way to attribute a win when both sides are the same class
    winnerClass: winnerIndex !== null ? bots[winnerIndex].class : null,
    timeToKillMs: winnerIndex !== null ? timeToKillMs : null,
    damageBySpell,
  };
}

parentPort.on('message', (msg) => {
  if (msg.type !== 'run') return;
  const { matchup, rounds } = msg;

  const results = [];
  const progressEvery = Math.max(1, Math.floor(rounds / 20));

  for (let i = 0; i < rounds; i++) {
    results.push(runRound(matchup));
    if ((i + 1) % progressEvery === 0 || i === rounds - 1) {
      parentPort.postMessage({ type: 'progress', completed: i + 1, total: rounds });
    }
  }

  // Aggregate
  const classA = matchup[0].class, classB = matchup[1].class;
  let winsA = 0, winsB = 0, draws = 0;
  let ttkTotal = 0, ttkCount = 0;
  const damageBySpell = {};

  for (const r of results) {
    // Attribute by side INDEX, not class name -- when both sides picked the
    // same class (common once a bracket has more entrants than classes),
    // comparing winnerClass to classA/classB can't tell the sides apart and
    // would silently credit every win to side A.
    if (r.winnerIndex === 0) winsA++;
    else if (r.winnerIndex === 1) winsB++;
    else draws++;

    if (r.timeToKillMs != null) { ttkTotal += r.timeToKillMs; ttkCount++; }

    for (const [spellId, entry] of Object.entries(r.damageBySpell)) {
      const agg = damageBySpell[spellId] ?? { totalDamage: 0, hits: 0 };
      agg.totalDamage += entry.totalDamage;
      agg.hits += entry.hits;
      damageBySpell[spellId] = agg;
    }
  }

  parentPort.postMessage({
    type: 'result',
    rounds,
    winRateByClass: {
      [classA]: winsA / rounds,
      [classB]: winsB / rounds,
    },
    // Index-disambiguated version of the above -- always correct even when
    // classA === classB, which winRateByClass alone can't represent.
    winRateBySide: [winsA / rounds, winsB / rounds],
    draws,
    avgTimeToKillMs: ttkCount > 0 ? Math.round(ttkTotal / ttkCount) : null,
    damageBySpell,
  });
});
