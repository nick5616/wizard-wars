// Shared helpers for the Playwright playtests. See browser-playtest.mjs for usage.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export const VITE = process.env.PT_VITE ?? 'http://localhost:3150';
export const PROXY = process.env.PT_PROXY ?? 'http://localhost:8250';
export const OUT = process.env.PT_OUT ?? '.';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const setNet = (q) => fetch(`${PROXY}/config?${new URLSearchParams(q)}`).then((r) => r.json());
export const NET = {
  clean: { latency: 0, jitter: 0, loss: 0, spikeEvery: 0, spikeMs: 0 },
  typical: { latency: 40, jitter: 10, loss: 0, spikeEvery: 0, spikeMs: 0 },
  bad: { latency: 120, jitter: 40, loss: 0.02, spikeEvery: 0, spikeMs: 0 },
  awful: { latency: 200, jitter: 80, loss: 0.05, spikeEvery: 7, spikeMs: 600 },
};
export const kill = () => fetch(`${PROXY}/kill`).then((r) => r.text());

export async function launch() {
  return chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required'],
  });
}

// Known-benign noise (headless GL driver chatter) that shouldn't count as a failure.
const IGNORE = [/GPU stall due to ReadPixels/, /GL Driver Message/, /Automatic fallback to software WebGL/, /Download the React DevTools/, /\[vite\]/];

/** One simulated player: its own context (=> own localStorage clientId), console capture, store helpers. */
export async function newClient(browser, name, { clientId, viewport = { width: 480, height: 270 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  if (clientId) await ctx.addInitScript((id) => { try { localStorage.setItem('wizardwars_client_id', id); } catch {} }, clientId);
  const page = await ctx.newPage();
  const c = { name, ctx, page, errors: [], warnings: [], logs: [] };
  page.on('console', (m) => {
    const t = m.text();
    if (IGNORE.some((r) => r.test(t))) return;
    if (m.type() === 'error') c.errors.push(t);
    else if (m.type() === 'warning') c.warnings.push(t);
    else c.logs.push(t);
  });
  page.on('pageerror', (e) => c.errors.push(`PAGEERROR ${e.message}`));
  c.goto = async () => {
    await page.goto(VITE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.useGameStore && window.__ws, null, { timeout: 30000, polling: 150 });
  };
  c.phase = () => page.evaluate(() => window.useGameStore.getState().phase);
  c.waitPhase = (p, timeout = 20000) => page.waitForFunction((p) => window.useGameStore.getState().phase === p, p, { timeout, polling: 150 });
  c.state = () => page.evaluate(() => {
    const g = window.useGameStore.getState(); const n = window.useNetworkStore.getState();
    return { phase: g.phase, menuOpen: g.menuOpen, local: g.local, players: Object.keys(g.players).length,
      projectiles: Object.keys(g.projectiles).length, effects: Object.keys(g.effects).length,
      matchActive: g.matchActive, countdown: g.matchCountdownEndsAt, vote: g.voteState, id: n.localPlayerId, room: n.roomId, connected: n.connected };
  });
  c.send = (type, payload = {}) => page.evaluate(([t, p]) => window.__ws.send(t, p), [type, payload]);
  c.shot = (label) => page.screenshot({ path: `${OUT}/${name}-${label}.png` });
  c.click = (text, opts = {}) => page.getByRole('button', { name: text, exact: opts.exact ?? false }).first().click({ timeout: 40000 });
  c.mem = () => page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  return c;
}

/** Click through Multiplayer -> class pick. */
export async function joinLobby(c, cls = 'fire') {
  await c.waitPhase('main_menu');
  await c.click('Multiplayer');
  await c.waitPhase('class_select');
  await pickClass(c, cls);
}
const LABEL = { fire: 'Fire', ice: 'Ice', dark: 'Dark', sword: 'Sword', druid: 'Druid', crystalmancer: 'Crystal' };
export async function pickClass(c, cls) {
  await c.page.getByRole('button', { name: new RegExp(LABEL[cls], 'i') }).first().click();
  // Spec cards are the 168px wide buttons.
  const card = c.page.locator('button[style*="width: 168px"]').first();
  await card.click();
  await c.waitPhase('playing', 15000);
}

export async function summary(clients) {
  for (const c of clients) {
    console.log(`[${c.name}] errors=${c.errors.length} warnings=${c.warnings.length}`);
    for (const e of [...new Set(c.errors)].slice(0, 8)) console.log(`   ERR ${e.slice(0, 300)}`);
  }
}

/** Record selected S2C events into window.__ev so scripts can assert on them. */
export async function hookEvents(c) {
  await c.page.evaluate(() => {
    if (window.__evHooked) return;
    window.__evHooked = true; window.__ev = [];
    for (const t of ['s2c:spell_cast', 's2c:spell_cast_denied', 's2c:hit_confirmed', 's2c:kill_feed', 's2c:player_died',
      's2c:player_respawned', 's2c:domain_start', 's2c:domain_end', 's2c:match_end', 's2c:match_countdown', 's2c:error',
      's2c:skill_vote_prompt', 's2c:skill_auto_unlocked', 's2c:level_up', 's2c:room_joined']) {
      window.__ws.on(t, (m) => window.__ev.push({ t: t.slice(4), at: Date.now(), ...m }));
    }
    window.__died = []; window.__ws.on('s2c:player_died', (m) => window.__died.push({ ...m, at: Date.now() }));
    window.__ws.on('s2c:game_tick', (m) => { window.__lastTick = { tick: m.tick, ids: Object.keys(m.players), eq0: m.players[window.useNetworkStore.getState().localPlayerId]?.equippedSpells?.[0] }; });
  });
  c.events = (type) => c.page.evaluate((t) => window.__ev.filter((e) => !t || e.t === t), type);
  c.clearEvents = () => c.page.evaluate(() => { window.__ev.length = 0; });
}

const SENS = 0.002; // CameraController MOUSE_SENSITIVITY
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** Closed-loop mouse aim at a world point (needs pointer lock on). Returns residual angle error. */
export async function aimAt(c, target, { eye = 1.6 } = {}) {
  let err = 9;
  for (let i = 0; i < 10; i++) {
    const me = await c.page.evaluate(() => { const g = window.useGameStore.getState(); const id = window.useNetworkStore.getState().localPlayerId; const p = g.players[id]; return { pos: g.local.position, yaw: p?.yaw ?? 0, pitch: p?.pitch ?? 0 }; });
    const dx = target.x - me.pos.x, dz = target.z - me.pos.z, dy = (target.y + 1) - (me.pos.y + eye - 1.8 + 1.8);
    const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    const ey = wrap(wantYaw - me.yaw), ep = wantPitch - me.pitch;
    err = Math.hypot(ey, ep);
    if (err < 0.03) break;
    // Synthetic relative motion (what pointer lock delivers); Playwright's absolute mouse.move can't express unbounded deltas.
    await c.page.evaluate(([dx, dy]) => document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy })),
      [Math.round(-ey / SENS), Math.round(-ep / SENS)]);
    await sleep(300);
  }
  return err;
}
export async function lockPointer(c) {
  const vp = c.page.viewportSize();
  await c.page.mouse.move(vp.width / 2, vp.height / 2);
  await c.page.mouse.down(); await c.page.mouse.up();
  // The click may land on a HUD overlay rather than the canvas (tiny viewports); the click still
  // grants user activation, so request the lock on the canvas directly.
  await c.page.evaluate(() => document.querySelector('canvas')?.requestPointerLock());
  await sleep(250);
  return c.page.evaluate(() => !!document.pointerLockElement);
}
export const fire = async (c, hold = 350) => { await c.page.mouse.down(); await sleep(hold); await c.page.mouse.up(); };

/** Same effect as Multiplayer -> class card click (App.onMultiplayer + ClassSelect.select) but without the DOM, for tiny low-CPU viewports. */
export async function joinLobbyFast(c, cls = 'fire', roomId = 'lobby') {
  await c.waitPhase('main_menu');
  await c.page.evaluate(([cls, roomId]) => {
    const id = window.useNetworkStore.getState().localPlayerId;
    window.__ws.send('c2s:join_room', { roomId, username: `Wizard_${id.slice(0, 4)}` });
    window.__ws.send('c2s:select_class', { class: cls });
    const g = window.useGameStore.getState(); g.setLocalClass(cls); g.setPhase('playing');
  }, [cls, roomId]);
  await c.waitPhase('playing', 15000);
}
