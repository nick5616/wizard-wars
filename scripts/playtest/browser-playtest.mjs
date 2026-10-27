#!/usr/bin/env node
/**
 * Wizard Wars browser playtest harness (Playwright, real Chromium, N simultaneous clients).
 *
 * Prereqs (own ports; see the sprint brief):
 *   PORT=8150 REDIS_URL=redis://127.0.0.1:1 node server/index.js
 *   node <tools>/netsim-proxy.mjs --listen 8250 --target ws://localhost:8150
 *   (cd client && VITE_WS_URL=ws://localhost:8250 npx vite --port 3150 --strictPort)
 *   !! Do not edit client/ or server/ sources while a run is in progress: Vite HMR remounts <App/>,
 *      which looks exactly like a mid-test disconnect/reconnect and produces bogus failures.
 *
 * Run (playwright comes from NODE_PATH, e.g. the shared tools dir):
 *   NODE_PATH=<tools>/node_modules PT_VITE=http://localhost:3150 PT_PROXY=http://localhost:8250 \
 *     PT_OUT=./shots node scripts/playtest/browser-playtest.mjs <scenario> --level=clean|typical|bad|awful
 *
 * Scenarios: boot  menus[:duel|:modes]  sweep[:class]  match  input  chaos  soak[:minutes]
 * Each scenario prints PASS/FAIL lines and merges them into $PT_OUT/results.json so a matrix of
 * item x network level can be assembled afterwards. --level switches the netsim proxy live
 * (GET /config) before the scenario runs.
 *
 * Notes on headless quirks handled here (see lib.mjs):
 *  - Pointer lock works headless once the canvas is clicked; Escape does NOT release it
 *    (Chrome's browser-level Esc handling), so Esc is emulated with document.exitPointerLock().
 *  - Mouse look is driven with synthetic relative mousemove events (movementX/Y) because
 *    Playwright's absolute mouse.move cannot express unbounded deltas.
 *  - Casts are edge-triggered per rendered frame; SwiftShader frames are slow, so the
 *    mouse button is held ~350ms or a click can fall between two frames and be missed.
 *  - page.waitForFunction uses polling:150 (the default 'raf' polling stalls on busy pages).
 *  - Dev-only window.useGameStore / useNetworkStore / __ws hooks (main.tsx, App.tsx) expose state.
 *  - Tiny viewports (480x270) keep SwiftShader CPU down when 2-4 clients run at once; scenarios
 *    that exercise real DOM menus use 1024x600.
 */
import fs from 'node:fs';
import {
  launch, newClient, joinLobby, joinLobbyFast, pickClass, sleep, hookEvents, aimAt, lockPointer, fire,
  setNet, NET, kill, OUT,
} from './lib.mjs';
import { equippableSpellsForClass, getSpell, MOBILITY_SPELL, DEFENSIVE_SPELL } from '../../shared/spells.js';
import { GAME_MODES, GAME_MODE_ORDER } from '../../shared/gameModes.js';
import { DUEL_OPPONENTS } from '../../shared/duelOpponents.js';

const CLASSES = ['fire', 'ice', 'dark', 'sword', 'druid', 'crystalmancer'];
const [scenarioArg = 'boot'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const level = (process.argv.find((a) => a.startsWith('--level=')) ?? '--level=clean').split('=')[1];
const [scenario, scenarioParam] = scenarioArg.split(':');

fs.mkdirSync(OUT, { recursive: true });
const resultsPath = `${OUT}/results.json`;
function record(item, ok, detail = '') {
  // Re-read each time so several scenario processes can share one results file.
  const results = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, 'utf8')) : {};
  results[item] ??= {};
  results[item][level] = { ok, detail };
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 1));
  console.log(`${ok ? 'PASS' : 'FAIL'} [${level}] ${item}${detail ? ' -- ' + detail : ''}`);
}

const VP_MENU = { width: 1024, height: 600 };
const VP_SMALL = { width: 480, height: 270 };

const scenarios = {
  async boot(browser) {
    const a = await newClient(browser, 'boot', { viewport: VP_MENU });
    await a.goto();
    await a.waitPhase('main_menu', 30000);
    await sleep(2500);
    const fonts = await a.page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
    await a.shot('menu');
    record('boot: main menu renders, no console errors', a.errors.length === 0, a.errors.join(' | ').slice(0, 200));
    record('boot: fonts load', fonts.includes('Cinzel Decorative') && fonts.includes('MedievalSharp'), fonts.join(','));
    record('boot: console warning flood (<20)', a.warnings.length + a.logs.length < 20, `${a.warnings.length}w ${a.logs.length}l`);
    await a.ctx.close();
  },

  /** Every single-player mode (rotating class) and every 1v1 opponent, through the real DOM menus. */
  async menus(browser, only) {
    const a = await newClient(browser, 'menus', { viewport: VP_MENU });
    await a.goto(); await a.waitPhase('main_menu');
    await hookEvents(a);
    let ci = 0;
    for (const mode of GAME_MODE_ORDER.filter((m) => m !== 'duel1v1' && only !== 'duel')) {
      const cls = CLASSES[ci++ % CLASSES.length];
      try {
        await a.click('Single Player'); await a.waitPhase('mode_select');
        await a.page.getByRole('button', { name: new RegExp(GAME_MODES[mode].label) }).first().click();
        await a.waitPhase('class_select');
        await pickClass(a, cls);
        const expected = GAME_MODES[mode].teamSizes.reduce((x, y) => x + y, 0);
        await sleep(1500);
        const st = await a.state();
        record(`menus: SP ${mode} as ${cls}`, st.phase === 'playing' && st.matchActive && st.players === expected,
          `phase=${st.phase} players=${st.players}/${expected} countdown=${!!st.countdown}`);
        await a.shot(`sp-${mode}`);
        await leaveMatch(a);
      } catch (e) { record(`menus: SP ${mode} as ${cls}`, false, String(e.message).slice(0, 100)); await recover(a); }
    }
    for (const opp of DUEL_OPPONENTS.filter(() => only !== 'modes')) {
      const cls = CLASSES[ci++ % CLASSES.length];
      try {
        await a.click('Single Player'); await a.waitPhase('mode_select');
        await a.page.getByRole('button', { name: /1v1\b/ }).first().click();
        await a.waitPhase('duel_select');
        await a.page.getByRole('button', { name: opp.name }).first().click();
        await a.waitPhase('class_select');
        await pickClass(a, cls);
        await a.page.waitForFunction(() => Object.keys(window.useGameStore.getState().players).length >= 2, null, { timeout: 5000, polling: 150 }).catch(() => {});
        const st = await a.state();
        record(`menus: duel vs ${opp.id}`, st.phase === 'playing' && st.matchActive && st.players === 2, `players=${st.players}`);
        await leaveMatch(a);
      } catch (e) { record(`menus: duel vs ${opp.id}`, false, String(e.message).slice(0, 100)); await recover(a); }
    }
    record('menus: no console errors', a.errors.length === 0, a.errors.slice(0, 3).join(' | ').slice(0, 300));
    await a.ctx.close();
  },

  /**
   * Cast every spell of every class (or one class: sweep:druid) from client A at a stationary victim V in the
   * shared lobby, using the real input path (mouse hold on the canvas, Shift/Q/F keys). A is put in debug mode
   * (C2S.DEBUG_GRANT: unlocks the whole tree, skips cooldowns/mana) and equips each spell into slot 0 in turn.
   */
  async sweep(browser, only) {
    const a = await newClient(browser, 'A', { viewport: VP_SMALL }); const v = await newClient(browser, 'V', { viewport: { width: 320, height: 180 } });
    await a.goto(); await v.goto();
    await joinLobbyFast(a, 'fire'); await joinLobbyFast(v, 'ice');
    await hookEvents(a); await hookEvents(v);
    await sleep(800);
    await a.send('c2s:debug_grant'); await v.send('c2s:debug_grant');
    if (!(await lockPointer(a))) record('sweep: pointer lock acquired', false);
    const vid = (await v.state()).id;
    // Direct-target spells legitimately get denied by the server when the dummy isn't frozen / hasn't been damaged / is behind terrain.
    const TARGET_DENIALS = new Set(['target_not_frozen', 'no_recent_damage', 'no_line_of_sight', 'out_of_range', 'invalid_target']);
    for (const cls of (only ? [only] : CLASSES)) {
      if ((await a.state()).local.class !== cls) {
        await a.send('c2s:select_class', { class: cls });
        await a.page.waitForFunction((c) => window.useGameStore.getState().local.class === c && window.useGameStore.getState().local.isAlive, cls, { timeout: 15000, polling: 150 }).catch(() => {});
        await sleep(400);
      }
      await a.send('c2s:debug_grant');
      await sleep(600);
      const spells = equippableSpellsForClass(cls).map((s) => s.id);
      for (const id of spells) {
        const errs0 = a.errors.length + v.errors.length;
        try {
          if (!(await v.state()).local.isAlive) { await v.send('c2s:respawn'); await sleep(500); }
          if (!(await a.state()).local.isAlive) { await a.send('c2s:respawn'); await sleep(900); await lockPointer(a); } // caster can die to its own lingering fire (see report)
          for (let attempt = 0; attempt < 3; attempt++) { // equip is idempotent; retry covers a message lost to a mid-run reconnect/HMR
            await a.send('c2s:equip_spell', { slotIndex: 0, spellId: id });
            await a.page.evaluate(() => window.useGameStore.getState().setActiveSlot(0));
            const got = await a.page.waitForFunction((s) => window.useGameStore.getState().local.equippedSpells[0] === s, id, { timeout: 5000, polling: 150 }).then(() => true, () => false);
            if (got) break;
            if (attempt === 2) throw new Error('equip never applied');
          }
          const vpos = await a.page.evaluate((i) => window.useGameStore.getState().players[i]?.position, vid);
          if (vpos) await aimAt(a, vpos);
          const hp0 = (await v.state()).local.health;
          await a.clearEvents();
          await fire(a, 350);
          await sleep(900);
          let ev = await a.events();
          if (!ev.some((e) => e.t === 'spell_cast' || e.t === 'spell_cast_denied')) { // first fire after a lock/class swap can land between frames: retry once
            if (vpos) await aimAt(a, vpos);
            await fire(a, 500); await sleep(900); ev = await a.events();
          }
          const cast = ev.find((e) => e.t === 'spell_cast' && e.spellId === id);
          const denied = ev.find((e) => e.t === 'spell_cast_denied');
          const hits = ev.filter((e) => e.t === 'hit_confirmed').length;
          const dn = hits ? await a.page.evaluate(() => window.useGameStore.getState().damageNumbers.length) : 0;
          const hp1 = (await v.state()).local.health;
          const newErrs = a.errors.length + v.errors.length - errs0;
          const stA = cast ? null : await a.state();
          const diag = stA ? ` [A=${stA.local.username} alive=${stA.local.isAlive} died=${JSON.stringify((await a.page.evaluate(() => window.__died.slice(-2))).map((d) => d.killerName + ':' + d.spellId))} phase=${stA.phase} menu=${stA.menuOpen} hp=${stA.local.health} fx=${Object.keys(ev.filter((e) => e.t)).length} evs=${ev.map((e) => e.t).join('|')}]` : '';
          const ok = (!!cast || (denied && getSpell(id)?.requiresTarget && TARGET_DENIALS.has(denied.reason))) && newErrs === 0;
          record(`sweep: ${cls}/${id}`, ok, `${cast ? 'cast' : 'DENIED:' + denied?.reason}${hits ? ' hits=' + hits + ' dmgNumbers=' + dn : ''}${hp1 < hp0 ? ' vHP ' + hp0 + '->' + hp1 : ''}${newErrs ? ' errors=' + newErrs : ''}${diag}`);
        } catch (e) {
          const st = await a.state().catch(() => null);
          const lt = await a.page.evaluate(() => ({ ...window.__lastTick, ids: window.__lastTick?.ids.length, storeTick: window.useGameStore.getState().serverTick })).catch(() => null);
          record(`sweep: ${cls}/${id}`, false, `${String(e.message).slice(0, 60)} eq=${st?.local.equippedSpells.slice(0, 3).join()} alive=${st?.local.isAlive} phase=${st?.phase} connected=${st?.connected} lastTick=${JSON.stringify(lt)}`);
        }
      }
      // Mobility (Shift), defensive (Q), melee (F), basic attack (RMB).
      for (const [label, key, spellId] of [['mobility', 'Shift', MOBILITY_SPELL[cls]], ['defensive', 'q', DEFENSIVE_SPELL[cls]], ['melee', 'f', null]]) {
        const errs0 = a.errors.length;
        const p0 = (await a.state()).local.position;
        await a.page.keyboard.down(key); await sleep(350); await a.page.keyboard.up(key);
        await sleep(600);
        const st = await a.state();
        const moved = Math.hypot(st.local.position.x - p0.x, st.local.position.z - p0.z);
        record(`sweep: ${cls}/${label}${spellId ? ' ' + spellId : ''}`, a.errors.length === errs0, `moved=${moved.toFixed(1)} defActive=${st.local.defensiveActive}`);
      }
      { const errs0 = a.errors.length; await a.page.mouse.down({ button: 'right' }); await sleep(500); await a.page.mouse.up({ button: 'right' }); await sleep(300);
        record(`sweep: ${cls}/basic-attack(RMB)`, a.errors.length === errs0); }
      await a.shot(`sweep-${cls}`);
      { // Unbounded server-side growth (effects/projectiles/payload) shows up here as the sweep proceeds.
        const g = await a.page.evaluate(() => { const s = window.useGameStore.getState(); return { fx: Object.keys(s.effects).length, pj: Object.keys(s.projectiles).length, br: Object.keys(s.barriers).length, dm: Object.keys(s.domains).length }; });
        record(`sweep: ${cls} leftover world state bounded`, g.fx < 40 && g.pj < 40, JSON.stringify(g)); }
    }
    record('sweep: no console errors overall', a.errors.length + v.errors.length === 0, [...a.errors, ...v.errors].slice(0, 3).join(' | ').slice(0, 300));
    await a.ctx.close(); await v.ctx.close();
  },

  /**
   * Match flow: duel vs the docile Ember Novice, win it with debug-mode spam (real mouse input), check the
   * end screen / ELO / return-to-menu, then start a SECOND match and verify nothing leaked from the first.
   */
  async match(browser) {
    const a = await newClient(browser, 'M', { viewport: { width: 640, height: 360 } });
    await a.goto(); await a.waitPhase('main_menu');
    await hookEvents(a);
    const startDuel = async (opp, cls) => {
      await a.page.evaluate(([opp, cls]) => {
        const id = window.useNetworkStore.getState().localPlayerId;
        window.__ws.send('c2s:start_match', { mode: 'duel1v1', class: cls, opponentId: opp, username: `Wizard_${id.slice(0, 4)}` });
        const g = window.useGameStore.getState(); g.setMatchActive(true); g.setLocalClass(cls);
      }, [opp, cls]);
      await a.waitPhase('playing');
      await a.page.waitForFunction(() => Object.keys(window.useGameStore.getState().players).length >= 2, null, { timeout: 10000, polling: 150 });
    };
    await startDuel('ember_novice', 'fire');
    const s0 = await a.state();
    record('match: countdown set on start', !!s0.countdown && s0.countdown > Date.now() - 1000, `endsAt-now=${s0.countdown - Date.now()}`);
    await sleep(500);
    await a.send('c2s:debug_grant');
    await sleep(800);
    await a.send('c2s:equip_spell', { slotIndex: 0, spellId: 'god_ray' }); // hitscan: the docile bot orbits the arena edge, projectiles would miss; debug grant leaves a rune (no direct damage) in slot 0
    await lockPointer(a);
    await a.page.evaluate(() => window.useGameStore.getState().setActiveSlot(0));
    await sleep(600);
    const t0 = Date.now();
    let ended = false;
    while (Date.now() - t0 < 120000) {
      const st = await a.state();
      if (st.phase === 'match_end') { ended = true; break; }
      const bot = await a.page.evaluate(() => Object.values(window.useGameStore.getState().players).find((p) => p.isBot));
      if (bot?.isAlive) {
        const me = await a.state();
        const dist = Math.hypot(bot.position.x - me.local.position.x, bot.position.z - me.local.position.z);
        // Phase 1: close the distance (terrain blocks the straight shot from the spawn). Phase 2: stand still, aim, shoot.
        if (process.env.PT_VERBOSE) console.log(`  [match] dist=${dist.toFixed(1)} botHP=${bot.health} me=${JSON.stringify(me.local.position)} bot=${JSON.stringify(bot.position)} myHP=${me.local.health}`);
        await aimAt(a, bot.position); await fire(a, 250);
      }
      await sleep(150);
    }
    await a.page.keyboard.up('w');
    record('match: duel won vs novice within 120s', ended, `${Math.round((Date.now() - t0) / 1000)}s`);
    if (!ended) { await a.shot('match-noend'); await a.ctx.close(); return; }
    await sleep(1200);
    await a.shot('match-end');
    const mr = await a.page.evaluate(() => window.useGameStore.getState().matchResult);
    const lockedAtEnd = await a.page.evaluate(() => !!document.pointerLockElement);
    record('match: end screen has result + standings + ELO', !!mr && mr.standings.length === 2 && !!mr.elo && mr.elo.eloDelta !== 0, JSON.stringify(mr?.elo));
    record('match: pointer lock released at match end', !lockedAtEnd);
    const txt = await a.page.evaluate(() => document.body.innerText);
    record('match: end screen shows VICTORY', /VICTORY/.test(txt));
    await sleep(900); // MatchEndScreen swallows input for its grace period
    await a.page.keyboard.press('Space');
    await a.waitPhase('main_menu', 10000);
    const s1 = await a.state();
    record('match: return to menu resets matchActive', !s1.matchActive, `matchActive=${s1.matchActive} alive=${s1.local.isAlive}`);
    record('match: local.isAlive cleared on return to menu (camera snap on next spawn)', s1.local.isAlive === false);
    await a.clearEvents();
    await startDuel('blade_novice', 'ice');
    await sleep(1500);
    const s2 = await a.page.evaluate(() => {
      const g = window.useGameStore.getState(); const id = window.useNetworkStore.getState().localPlayerId; const me = g.players[id];
      const ids = Object.values(g.players).map((p) => p.class + (p.isBot ? '(bot)' : ''));
      return { n: ids.length, ids, proj: Object.keys(g.projectiles).length, fx: Object.keys(g.effects).length,
        cds: Object.values(g.local.cooldowns).filter((v) => v > 0).length, hp: g.local.health,
        camDist: Math.hypot(g.local.position.x - (me?.position.x ?? 0), g.local.position.z - (me?.position.z ?? 0)),
        cls: g.local.class, alive: g.local.isAlive, kills: g.local.kills, countdown: g.matchCountdownEndsAt - Date.now(), killFeed: g.killFeed.length, lock: !!document.pointerLockElement };
    });
    record('match #2: only 2 players, no stale projectiles/effects', s2.n === 2 && s2.proj === 0 && s2.fx <= 2, JSON.stringify(s2));
    record('match #2: fresh cooldowns/hp/class', s2.cds === 0 && s2.hp === 200 && s2.cls === 'ice' && s2.alive);
    record('match #2: local position near server spawn', s2.camDist < 3, `dist=${s2.camDist.toFixed(1)}`);
    record('match #2: new countdown running', s2.countdown > 0, `${s2.countdown}ms left`);
    await a.shot('match2');
    record('match: no console errors', a.errors.length === 0, a.errors.slice(0, 3).join(' | ').slice(0, 300));
    await a.ctx.close();
  },

  /** Defeat flow: idle against the aggressive Inferno Veteran until eliminated -> death screen -> DEFEATED end screen -> menu. */
  async defeat(browser) {
    const a = await newClient(browser, 'D', { viewport: { width: 640, height: 360 } });
    await a.goto(); await a.waitPhase('main_menu');
    await hookEvents(a);
    await a.page.evaluate(() => {
      const id = window.useNetworkStore.getState().localPlayerId;
      window.__ws.send('c2s:start_match', { mode: 'duel1v1', class: 'ice', opponentId: 'inferno_veteran', username: `Wizard_${id.slice(0, 4)}` });
      const g = window.useGameStore.getState(); g.setMatchActive(true); g.setLocalClass('ice');
    });
    await a.waitPhase('playing');
    await lockPointer(a);
    await sleep(800);
    // The real bots rarely finish an idle player inside a reasonable time (see report), so drive the SAME client
    // handlers the server would: dispatch the S2C events locally (WebSocketClient._dispatch).
    const me = (await a.state()).id;
    await a.page.evaluate((me) => window.__ws._dispatch({ type: 's2c:player_died', playerId: me, killerName: 'FireBot_1234', killerSymbol: 'F', spellId: 'fireball' }), me);
    await sleep(900);
    await a.shot('defeat-dead');
    const dead = await a.page.evaluate(() => ({ phase: window.useGameStore.getState().phase, txt: document.body.innerText, music: window.__audio?.currentMusicId }));
    record('defeat: death screen shows killer + match-elimination text', dead.phase === 'dead' && /FireBot_1234/.test(dead.txt) && /Eliminated/i.test(dead.txt), `phase=${dead.phase}`);
    record('defeat: death sting plays on death screen', dead.music === 'music_death', `music=${dead.music}`);
    await a.page.keyboard.press('Space'); await sleep(500); // must NOT respawn in a match room (server rejects, client must stay on screen)
    record('defeat: keypress on match death screen does not leave it', (await a.state()).phase === 'dead');
    const myTeam = await a.page.evaluate(() => window.useGameStore.getState().local.team);
    await a.page.evaluate((team) => window.__ws._dispatch({ type: 's2c:match_end', winningTeam: team === 1 ? 0 : 1, standings: [team === 1 ? 0 : 1, team ?? 0],
      players: [], elo: { eloBefore: 1000, eloAfter: 976, eloDelta: -24, opponentElo: 1450 } }), myTeam);
    await sleep(1500);
    await a.shot('defeat-end');
    const st = await a.state();
    const txt = await a.page.evaluate(() => document.body.innerText);
    const music2 = await a.page.evaluate(() => window.__audio?.currentMusicId);
    record('defeat: end screen shows DEFEATED + ELO loss', st.phase === 'match_end' && /DEFEATED/.test(txt) && /-24|24/.test(txt), `phase=${st.phase}`);
    record('defeat: death sting still/again selected at DEFEATED end screen', music2 === 'music_death', `music=${music2}`);
    record('defeat: pointer lock released', !(await a.page.evaluate(() => !!document.pointerLockElement)));
    await sleep(900);
    await a.page.keyboard.press('Space');
    await a.waitPhase('main_menu', 10000);
    await sleep(1200);
    const menuMusic = await a.page.evaluate(() => window.__audio?.currentMusicId);
    record('defeat: back at menu with menu music (no death sting left playing)', menuMusic === 'music_menu', `music=${menuMusic}`);
    // Rematch after a defeat: nothing leaks.
    await a.page.evaluate(() => {
      window.__ws.send('c2s:start_match', { mode: 'duel1v1', class: 'fire', opponentId: 'ember_novice' });
      const g = window.useGameStore.getState(); g.setMatchActive(true); g.setLocalClass('fire');
    });
    await a.waitPhase('playing'); await sleep(1500);
    const s2 = await a.state();
    record('defeat: rematch starts clean (alive, 2 players, full hp)', s2.local.isAlive && s2.players === 2 && s2.local.health === 200, `alive=${s2.local.isAlive} players=${s2.players} hp=${s2.local.health}`);
    const m3 = await a.page.evaluate(() => window.__audio?.currentMusicId);
    record('defeat: no music in match', m3 == null, `music=${m3}`);
    record('defeat: no console errors', a.errors.length === 0, a.errors.slice(0, 3).join(' | ').slice(0, 300));
    await a.ctx.close();
  },

  /** Pointer lock, Esc-Esc, blur/stuck keys, number keys, wheel, pause menu tabs, skill vote UI, labs open/close. */
  async input(browser) {
    const a = await newClient(browser, 'I', { viewport: VP_MENU });
    await a.goto(); await joinLobby(a, 'fire');
    await hookEvents(a);
    await sleep(1000);
    const menuShown = () => a.page.evaluate(() => /glossary/i.test(document.body.innerText));
    const pos = () => a.page.evaluate(() => { const g = window.useGameStore.getState(); const p = g.players[window.useNetworkStore.getState().localPlayerId]; return p ? { x: p.position.x, z: p.position.z } : null; });
    // Real server skill-point flow: a fresh wizard has 1 point and several legal nodes -> server sends a non-blocking prompt.
    const gotPrompt = await a.page.waitForFunction(() => !!window.useGameStore.getState().voteState, null, { timeout: 8000, polling: 150 }).then(() => true, () => false);
    const nodes0 = (await a.state()).local.unlockedNodes?.length ?? 0;
    if (gotPrompt) { await a.page.keyboard.press('F1'); await sleep(1200); }
    const st0 = await a.state();
    record('input: real server skill prompt answered with F1 unlocks a node', gotPrompt && st0.vote === null && (st0.local.unlockedNodes?.length ?? 0) > nodes0, `prompt=${gotPrompt} nodes ${nodes0}->${st0.local.unlockedNodes?.length} skillPoints=${st0.local.skillPoints}`);
    record('input: click canvas acquires pointer lock', await lockPointer(a));

    const slot = () => a.page.evaluate(() => window.useGameStore.getState().local.activeSlot);
    await a.page.keyboard.press('Digit2'); await sleep(200);
    const s2 = await slot();
    await a.page.keyboard.press('Digit1'); await sleep(200);
    const s1 = await slot();
    record('input: number keys select slots', s2 === 1 && s1 === 0, `after 2=${s2} after 1=${s1}`);
    await a.page.mouse.wheel(0, 100); await sleep(250);
    const sw = await slot();
    record('input: mouse wheel changes slot', sw !== 0, `slot=${sw}`);
    await a.page.keyboard.press('Digit1'); await sleep(150);

    // Esc-Esc. Chrome swallows the first Esc keydown while locked and just releases the lock -> emulate that.
    await a.page.evaluate(() => document.exitPointerLock()); await sleep(500);
    const open1 = await menuShown();
    await a.page.keyboard.press('Escape'); await sleep(500);
    const closed1 = !(await menuShown());
    await a.page.keyboard.press('Escape'); await sleep(500);
    const open2 = await menuShown();
    await a.page.keyboard.press('Escape'); await sleep(500);
    const closed2 = !(await menuShown());
    record('input: Esc releases lock and opens pause menu', open1);
    record('input: Esc-Esc toggles menu closed/open/closed', closed1 && open2 && closed2, `${open1}/${closed1}/${open2}/${closed2}`);
    record('input: menuOpen cleared after closing pause menu', (await a.state()).menuOpen === false);
    await a.page.keyboard.press('Tab'); await sleep(500);
    record('input: Tab opens pause menu on skill tree', await menuShown());
    await a.shot('input-tab');
    await a.page.keyboard.press('Escape'); await sleep(400);

    // Stuck keys on blur: hold W, blur the window, the wizard must stop.
    await lockPointer(a);
    await a.page.keyboard.down('w'); await sleep(900);
    const pA = await pos(); await sleep(600); const pB = await pos();
    const moving = Math.hypot(pB.x - pA.x, pB.z - pA.z) > 0.3; // (speed fidelity is the separate `move` scenario)
    await a.page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await sleep(700); const pC = await pos(); await sleep(700); const pD = await pos();
    const drift = Math.hypot(pD.x - pC.x, pD.z - pC.z);
    await a.page.keyboard.up('w');
    record('input: W moves the wizard', moving, `moved ${Math.hypot(pB.x - pA.x, pB.z - pA.z).toFixed(1)}`);
    record('input: blur releases held movement keys', drift < 0.5, `drift after blur ${drift.toFixed(1)}`);

    // Skill vote UI (synthetic server prompt): non-blocking spend + blocking fork.
    await a.page.evaluate(() => window.__ws._dispatch({ type: 's2c:skill_vote_prompt', promptId: 'x1', branchGroup: null, blocking: false,
      options: [{ id: 'spark_shot', label: 'Spark Shot', description: 'd' }, { id: 'kindling', label: 'Kindling', description: 'd' }] }));
    await sleep(500);
    const nb = await a.state();
    record('input: non-blocking vote prompt does not freeze input', !!nb.vote && nb.vote.blocking === false && nb.menuOpen === false);
    await a.page.keyboard.press('F1'); await sleep(400);
    record('input: F1 answers vote prompt', (await a.state()).vote === null);
    await lockPointer(a);
    await a.page.evaluate(() => window.__ws._dispatch({ type: 's2c:skill_vote_prompt', promptId: 'x2', branchGroup: 'g', blocking: true,
      options: [{ id: 'spark_shot', label: 'Spark Shot', description: 'd' }, { id: 'kindling', label: 'Kindling', description: 'd' }] }));
    await sleep(700);
    const fk = await a.page.evaluate(() => ({ lock: !!document.pointerLockElement, menuOpen: window.useGameStore.getState().menuOpen, pause: /glossary/i.test(document.body.innerText) }));
    record('input: fork screen releases lock, blocks input, no ghost pause menu', !fk.lock && fk.menuOpen && !fk.pause, JSON.stringify(fk));
    await a.shot('input-fork');
    await a.page.keyboard.press('F2'); await sleep(700);
    const fk2 = await a.page.evaluate(() => ({ vote: window.useGameStore.getState().voteState, pause: /glossary/i.test(document.body.innerText), menuOpen: window.useGameStore.getState().menuOpen }));
    record('input: after fork choice, no pause menu pops up and input resumes', fk2.vote === null && !fk2.pause && !fk2.menuOpen, JSON.stringify(fk2));

    // Pause menu tabs + labs.
    await a.page.evaluate(() => document.exitPointerLock()); await sleep(500);
    for (const t of ['Skill Tree', 'Glossary', 'Settings', 'Spells']) {
      try { await a.page.getByRole('button', { name: t, exact: true }).first().click({ timeout: 8000 }); await sleep(250); record(`input: pause tab ${t}`, true); }
      catch (e) { record(`input: pause tab ${t}`, false, String(e.message).slice(0, 80)); }
    }
    await a.page.getByRole('button', { name: 'Settings', exact: true }).first().click(); await sleep(300);
    try {
      await a.page.getByRole('button', { name: /^(Enter|Resume)$/ }).nth(0).click({ timeout: 6000 }); await sleep(1500);
      await a.shot('input-experiment-lab');
      const room = (await a.state()).room;
      record('input: Experiment Lab opens (private experiment room)', !!room && room.startsWith('experiment-'), `room=${room}`);
      await a.page.keyboard.press('Escape'); await sleep(500);
      const afterEsc = await a.page.evaluate(() => ({ lab: /experiment lab/i.test(document.body.innerText) && !!document.querySelector('div[style*="z-index: 600"]'), pause: /glossary/i.test(document.body.innerText) }));
      record('input: Esc inside the Experiment Lab closes the lab (does not stack a hidden pause menu under it)', !afterEsc.pause, JSON.stringify(afterEsc));
      await a.shot('input-lab-after-esc');
    } catch (e) { record('input: Experiment Lab opens (private experiment room)', false, String(e.message).slice(0, 100)); }
    record('input: no console errors', a.errors.length === 0, a.errors.slice(0, 3).join(' | ').slice(0, 300));
    await a.ctx.close();
  },

  /** Reconnect + duplicate clientId + network-chaos behaviours (run at each --level for the matrix columns). */
  async chaos(browser) {
    const id = '99999999-9999-4999-8999-999999999999';
    const a = await newClient(browser, 'C1', { clientId: id, viewport: VP_SMALL });
    const v = await newClient(browser, 'CV', { viewport: { width: 320, height: 180 } });
    await a.goto(); await v.goto();
    await joinLobbyFast(a, 'fire'); await joinLobbyFast(v, 'ice');
    await hookEvents(a); await hookEvents(v);
    await sleep(1000);
    await a.send('c2s:debug_grant');
    await lockPointer(a);
    // Casts feel delayed but still work.
    const vid = (await v.state()).id;
    let ok = 0; const tries = 4; const lat = [];
    for (let i = 0; i < tries; i++) {
      const vpos = await a.page.evaluate((i2) => window.useGameStore.getState().players[i2]?.position, vid);
      await aimAt(a, vpos);
      await a.clearEvents();
      const t0 = Date.now();
      await fire(a, 350);
      if (!(await a.page.waitForFunction(() => window.__ev.some((e) => e.t === 'spell_cast' || e.t === 'spell_cast_denied'), null, { timeout: 2500, polling: 100 }).then(() => true, () => false))) { await fire(a, 500); } // a press can fall between two slow frames
      try { await a.page.waitForFunction(() => window.__ev.some((e) => e.t === 'spell_cast' || e.t === 'spell_cast_denied'), null, { timeout: 8000, polling: 100 }); ok++; lat.push(Date.now() - t0 - 350); } catch { /* none */ }
      await sleep(400);
    }
    record('chaos: casts register', ok === tries, `${ok}/${tries} cast->ack ${lat.join('/')}ms`);
    const st1 = await a.state();
    record('chaos: no stuck casting/UI state', st1.phase === 'playing' && !st1.menuOpen);

    // /kill reconnect.
    await a.clearEvents();
    await kill();
    await a.page.waitForFunction(() => !window.useNetworkStore.getState().connected, null, { timeout: 8000, polling: 100 }).catch(() => {});
    const banner = await a.page.evaluate(() => /reconnecting/i.test(document.body.innerText));
    record('chaos: disconnect shows a reconnecting banner', banner);
    await a.page.waitForFunction(() => window.useNetworkStore.getState().connected, null, { timeout: 30000, polling: 150 }).catch(() => {});
    await sleep(1500);
    const st2 = await a.state();
    record('chaos: /kill reconnect lands on a clean main menu', st2.connected && st2.phase === 'main_menu' && st2.players === 0 && !st2.matchActive, JSON.stringify({ phase: st2.phase, players: st2.players, c: st2.connected }));
    await v.page.waitForFunction(() => window.useNetworkStore.getState().connected, null, { timeout: 30000, polling: 150 }).catch(() => {});
    await joinLobbyFast(v, 'ice'); // /kill dropped V too
    await joinLobbyFast(a, 'fire');
    await sleep(2000);
    const dup = await v.page.evaluate(() => Object.values(window.useGameStore.getState().players).map((p) => p.username));
    record('chaos: after rejoin no duplicate/ghost players seen by peer', dup.length === 2 && new Set(dup).size === 2, JSON.stringify(dup));
    // Same clientId in a second tab: server tears down the stale one.
    const a2 = await newClient(browser, 'C1b', { clientId: id, viewport: { width: 320, height: 180 } });
    await a2.goto(); await sleep(1500);
    await joinLobbyFast(a2, 'ice'); await sleep(1500);
    const seen = await v.page.evaluate(() => Object.values(window.useGameStore.getState().players).length);
    record('chaos: same-clientId second tab replaces the first, no duplicate', seen >= 1 && seen <= 2, `peer sees ${seen} players`);
    // NOTE: the netsim proxy drops WebSocket close codes (it calls close() with none), so a duplicate tab can only be
    // checked here at the level of "peer sees exactly 2 players"; the 4001 protocol is verified directly below.
    {
      const { createRequire } = await import('node:module');
      const WS = createRequire(import.meta.url)('ws');
      const dupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const url = `ws://localhost:${process.env.PT_SERVER_PORT ?? 8150}?clientId=${dupId}`;
      const first = new WS(url); const code = new Promise((res) => first.on('close', (c) => res(c)));
      await new Promise((r) => first.on('open', r)); await sleep(300);
      const second = new WS(url); await new Promise((r) => second.on('open', r));
      const got = await Promise.race([code, sleep(4000).then(() => null)]);
      record('chaos: server closes the stale same-clientId socket with code 4001 (direct, no proxy)', got === 4001, `code=${got}`);
      second.close();
    }
    await a.ctx.close(); // stop tab 1: through the proxy it keeps reconnect-warring (proxy strips close codes), which would pollute the connection count
    {
      const before = await fetch(`${process.env.PT_PROXY ?? 'http://localhost:8250'}/stats`).then((r) => r.json()).then((j) => j.connections);
      await a2.page.evaluate(() => window.__ws.ws.onclose({ code: 4001, reason: 'replaced', wasClean: true }));
      await sleep(4000);
      const after = await fetch(`${process.env.PT_PROXY ?? 'http://localhost:8250'}/stats`).then((r) => r.json()).then((j) => j.connections);
      const banner = await a2.page.evaluate(() => /another tab/i.test(document.body.innerText));
      record('chaos: client given close 4001 shows a banner and does not auto-reconnect', banner && after === before, `banner=${banner} newConnections=${after - before}`);
    }
    record('chaos: no page errors', [a, v, a2].every((c) => c.errors.every((e) => !/PAGEERROR/.test(e))), [a, v, a2].flatMap((c) => c.errors).slice(0, 3).join(' | ').slice(0, 300));
    await v.ctx.close(); await a2.ctx.close();
  },

  /** Airbud (druid summon) stress + the one-domain-at-a-time rule between two real clients. */
  async summon(browser) {
    const a = await newClient(browser, 'SA', { viewport: VP_SMALL }); const v = await newClient(browser, 'SV', { viewport: VP_SMALL });
    await a.goto(); await v.goto();
    await joinLobbyFast(a, 'druid'); await joinLobbyFast(v, 'ice');
    await hookEvents(a); await hookEvents(v);
    await sleep(800);
    await a.send('c2s:debug_grant'); await v.send('c2s:debug_grant');
    await sleep(800);
    await lockPointer(a); await lockPointer(v);
    const equip = async (c, id) => { await c.send('c2s:equip_spell', { slotIndex: 0, spellId: id });
      await c.page.evaluate(() => window.useGameStore.getState().setActiveSlot(0));
      await c.page.waitForFunction((s) => window.useGameStore.getState().local.equippedSpells[0] === s, id, { timeout: 10000, polling: 150 }); };
    const fx = (c, type) => c.page.evaluate((t) => Object.values(window.useGameStore.getState().effects).filter((e) => e.type === t).length, type);
    const frames = (c, ms) => c.page.evaluate((ms) => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > ms) res(n / (ms / 1000)); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), ms);
    const vid = (await v.state()).id, aid = (await a.state()).id;
    await equip(a, 'summon_airbud');
    const fps0 = await frames(a, 1500);
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) { // spam three summons (debug mode: no cooldown)
      const vpos = await a.page.evaluate((i2) => window.useGameStore.getState().players[i2]?.position, vid);
      await aimAt(a, vpos); await a.clearEvents(); await fire(a, 350); await sleep(500);
    }
    let seenA = 0; let seenV = 0; let vDied = false; let peak = 0;
    for (let i = 0; i < 40 && !(vDied && seenA > 0); i++) {
      seenA = Math.max(seenA, await fx(a, 'airbud')); seenV = Math.max(seenV, await fx(v, 'airbud')); peak = Math.max(peak, seenA);
      if (!(await v.state()).local.isAlive) vDied = true;
      await sleep(500);
    }
    record('summon: airbud appears on caster and on remote client', seenA > 0 && seenV > 0, `caster=${seenA} remote=${seenV}`);
    const fps1 = await frames(a, 1500);
    record('summon: frame rate with airbuds out not collapsed (>40% of baseline)', fps1 > fps0 * 0.4, `${fps0.toFixed(1)} -> ${fps1.toFixed(1)}`);
    const killFeed = (await v.events('kill_feed')).concat(await a.events('kill_feed'));
    record('summon: airbud can kill the victim (hop + land) within 20s', vDied, `died=${vDied} kills=${killFeed.length}`);
    if (vDied) { // death screen + keypress respawn in a lobby (respawn-enabled room)
      await sleep(400);
      const ds = await v.page.evaluate(() => ({ phase: window.useGameStore.getState().phase, txt: /respawn/i.test(document.body.innerText), killer: window.useGameStore.getState().lastDeath }));
      await v.shot('summon-v-dead');
      await v.page.keyboard.press('Space'); await sleep(1500);
      const afterPhase = (await v.state()).phase;
      record('summon: victim sees death screen (killer + respawn prompt) and keypress respawns', ds.phase === 'dead' && ds.txt && afterPhase === 'playing', `${JSON.stringify(ds)} after=${afterPhase}`);
    }
    // Expiry: effects list must drain (duration 15s) -- wait it out.
    await sleep(17000);
    const left = await fx(a, 'airbud');
    record('summon: airbuds expire and are removed from client state', left === 0, `left=${left}`);
    record('summon: owner is never squashed by own airbud', (await a.state()).local.isAlive, `peak simultaneous=${peak}`);
    await a.shot('summon-a');
    // Domains: only one at a time. A (druid) casts Wildwood Domain, V (ice) tries Absolute Zero right after.
    if (!(await v.state()).local.isAlive) { await v.send('c2s:respawn'); await sleep(1200); }
    await equip(a, 'wildwood_domain'); await equip(v, 'absolute_zero');
    await aimAt(a, await a.page.evaluate((i2) => window.useGameStore.getState().players[i2]?.position, vid));
    await a.clearEvents(); await v.clearEvents();
    await fire(a, 350); await sleep(700);
    await aimAt(v, await v.page.evaluate((i2) => window.useGameStore.getState().players[i2]?.position, aid));
    await fire(v, 350); await sleep(1200);
    const aEv = await a.events(); const vEv = await v.events();
    const aDom = aEv.some((e) => e.t === 'spell_cast' && e.spellId === 'wildwood_domain');
    const vDenied = vEv.find((e) => e.t === 'spell_cast_denied');
    const doms = await a.page.evaluate(() => Object.keys(window.useGameStore.getState().domains).length);
    record('summon: first domain cast is accepted', aDom);
    record('summon: second concurrent domain is denied with domain_active', vDenied?.reason === 'domain_active', `reason=${vDenied?.reason} activeDomains=${doms}`);
    record('summon: no console errors', a.errors.length + v.errors.length === 0, [...a.errors, ...v.errors].slice(0, 3).join(' | ').slice(0, 300));
    await a.ctx.close(); await v.ctx.close();
  },

  /**
   * Movement fidelity: hold W for 3s and compare the SERVER-authoritative travelled distance with the client-predicted one,
   * alongside the client's rendered fps. The client sends at most one input per rendered frame (CameraController) while
   * the server applies one input per 64Hz tick, so a slow-rendering client is simulated slower than it predicted.
   */
  async move(browser) {
    const a = await newClient(browser, 'MV', { viewport: VP_SMALL });
    await a.goto(); await joinLobbyFast(a, 'fire');
    await hookEvents(a);
    await a.page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await sleep(1500); await lockPointer(a);
    const snap = () => a.page.evaluate(() => { const g = window.useGameStore.getState(); const p = g.players[window.useNetworkStore.getState().localPlayerId]; return { sx: p.position.x, sz: p.position.z, cx: g.local.position.x, cz: g.local.position.z, f: window.__frames, t: performance.now() }; });
    // Strafe left/right alternately so we stay inside the arena.
    const dist = (p, q, ax, az) => Math.hypot(q[ax] - p[ax], q[az] - p[az]);
    let s0 = await snap();
    await a.page.keyboard.down('a'); await sleep(3000);
    const s1 = await snap();
    await a.page.keyboard.up('a'); await sleep(800);
    const s2 = await snap();
    const fps = (s1.f - s0.f) / ((s1.t - s0.t) / 1000);
    const serverSpeed = dist(s0, s1, 'sx', 'sz') / ((s1.t - s0.t) / 1000);
    const predSpeed = dist(s0, s1, 'cx', 'cz') / ((s1.t - s0.t) / 1000);
    const diverge = Math.hypot(s1.sx - s1.cx, s1.sz - s1.cz);
    record('move: server speed matches client prediction (>=80%)', serverSpeed >= predSpeed * 0.8, `fps=${fps.toFixed(0)} serverSpeed=${serverSpeed.toFixed(1)}m/s predicted=${predSpeed.toFixed(1)}m/s (nominal 8)`);
    record('move: predicted vs server position divergence while running <3m', diverge < 3, `diverge=${diverge.toFixed(1)}m settle=${Math.hypot(s2.sx - s2.cx, s2.sz - s2.cz).toFixed(1)}m`);
    // Same run with the page's CPU throttled so it renders far below 64fps (a typical laptop / busy scene).
    const cdp = await a.page.context().newCDPSession(a.page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.PT_THROTTLE ?? 5) });
    await sleep(1500);
    await a.page.keyboard.down('d'); await sleep(500); // build up to cruising speed first
    const t0 = await snap(); await sleep(3000); const t1 = await snap();
    await a.page.keyboard.up('d');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const fpsT = (t1.f - t0.f) / ((t1.t - t0.t) / 1000);
    const secs = (t1.t - t0.t) / 1000;
    const serverT = dist(t0, t1, 'sx', 'sz') / secs; const predT = dist(t0, t1, 'cx', 'cz') / secs;
    record('move: server speed matches prediction on a slow-rendering client (>=80%)', serverT >= predT * 0.8, `fps=${fpsT.toFixed(0)} serverSpeed=${serverT.toFixed(1)}m/s predicted=${predT.toFixed(1)}m/s`);
    await a.ctx.close();
  },

  /** One client in a bot match for N minutes (soak:10): errors, JS heap growth, frame rate collapse. */
  async soak(browser, minutes = '10') {
    const a = await newClient(browser, 'S', { viewport: VP_SMALL });
    await a.goto(); await a.waitPhase('main_menu');
    await hookEvents(a);
    await a.page.evaluate(() => {
      const id = window.useNetworkStore.getState().localPlayerId;
      window.__ws.send('c2s:join_room', { roomId: 'lobby', username: `Wizard_${id.slice(0, 4)}` });
      window.__ws.send('c2s:select_class', { class: 'fire' });
      window.__ws.send('c2s:spawn_bots', {});
      const g = window.useGameStore.getState(); g.setLocalClass('fire'); g.setPhase('playing');
    });
    await a.waitPhase('playing');
    await a.send('c2s:debug_grant');
    await a.page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; requestAnimationFrame(f); });
    const samples = [];
    const start = Date.now();
    const end = start + Number(minutes) * 60000;
    let respawns = 0;
    while (Date.now() < end) {
      const st = await a.state();
      if (st.phase === 'dead') { await a.send('c2s:respawn'); respawns++; }
      await lockPointer(a);
      await a.page.keyboard.down('d'); await fire(a, 300); await a.page.keyboard.up('d');
      const f0 = await a.page.evaluate(() => window.__frames); await sleep(5000); const f1 = await a.page.evaluate(() => window.__frames);
      samples.push({ t: Math.round((Date.now() - start) / 1000), fps: (f1 - f0) / 5, heap: await a.mem(), players: st.players, fx: st.effects });
    }
    const early = samples.slice(0, 3); const late = samples.slice(-3);
    const avg = (arr, k) => arr.reduce((s, x) => s + (x[k] ?? 0), 0) / Math.max(1, arr.length);
    console.log(JSON.stringify(samples));
    record('soak: JS heap growth < 2x', avg(late, 'heap') < Math.max(80, avg(early, 'heap') * 2), `${avg(early, 'heap').toFixed(0)}MB -> ${avg(late, 'heap').toFixed(0)}MB`);
    record('soak: fps does not collapse (>50% of early)', avg(late, 'fps') > avg(early, 'fps') * 0.5, `${avg(early, 'fps').toFixed(1)} -> ${avg(late, 'fps').toFixed(1)}`);
    record('soak: no console errors', a.errors.length === 0, a.errors.slice(0, 3).join(' | ').slice(0, 300));
    record('soak: still connected and playing/dead (not stuck)', ['playing', 'dead'].includes((await a.state()).phase), `respawns=${respawns}`);
    await a.ctx.close();
  },
};

/** Leave a running match the only way the UI offers mid-match: Disconnect (reload), then boot again. */
async function leaveMatch(c) {
  await c.page.reload({ waitUntil: 'domcontentloaded' });
  await c.page.waitForFunction(() => window.useGameStore && window.__ws, null, { polling: 150 });
  await c.waitPhase('main_menu', 30000);
  await hookEvents(c);
}
async function recover(c) { try { await leaveMatch(c); } catch { /* ignore */ } }

await setNet(NET[level]);
const browser = await launch();
try {
  const fn = scenarios[scenario];
  if (!fn) throw new Error(`unknown scenario ${scenario}`);
  await fn(browser, scenarioParam);
} finally { await browser.close(); }
