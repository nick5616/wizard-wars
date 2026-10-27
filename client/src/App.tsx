/**
 * App root. Owns the WebSocket client, networking singletons, and
 * dispatches server messages to the game store.
 */

import { useEffect, useRef, useState } from 'react';
import { WebSocketClient } from './networking/WebSocketClient';
import { ClockSync } from './networking/ClockSync';
import { ClientPrediction } from './networking/ClientPrediction';
import { EntityInterpolation } from './networking/EntityInterpolation';
import { netDebug } from './networking/netDebug';
import { useGameStore, expandTickPayload, type MatchResultPlayer } from './stores/gameStore';
import { useNetworkStore } from './stores/networkStore';
import { Scene } from './components/core/Scene';
import { HUD } from './components/ui/HUD';
import { MainMenu } from './components/ui/MainMenu';
import { ModeSelect } from './components/ui/ModeSelect';
import { DuelSelect } from './components/ui/DuelSelect';
import { ClassSelect } from './components/ui/ClassSelect';
import { MatchEndScreen } from './components/ui/MatchEndScreen';
import { MatchCountdown } from './components/ui/MatchCountdown';
import { PauseMenu } from './components/ui/PauseMenu';
import { ExperimentLab } from './components/ui/ExperimentLab';
import { DesignLab } from './components/ui/DesignLab';
import { NotificationFeed } from './components/ui/NotificationFeed';
import { SkillVotePrompt } from './components/ui/SkillVotePrompt';
import { DeathScreen } from './components/ui/DeathScreen';
import { audioManager } from './audio/AudioManager';
import { getSpell } from 'shared/spells';
import { S2C, C2S } from 'shared/events';
import { RANKS } from 'shared/leveling';
import type { GameTickPayload, PlayerState, ProjectileState, WizardClass } from './types/game.types';
import { IS_LOCALHOST } from './utils/isLocalhost';
import { getOrCreateClientId } from './utils/clientId';

// How often GAME_TICK payloads get synced into the React store, well below
// the server's 64Hz tick rate -- see the GAME_TICK handler below for why.
const REACT_SYNC_HZ = 20;
const REACT_SYNC_INTERVAL_MS = 1000 / REACT_SYNC_HZ;

/**
 * Folds a delta tick's partial entries into `backlog` (keyed by id, merged
 * field by field) and drops backlog entries that left the world.
 */
function accumulate<T extends object>(backlog: Record<string, T>, incoming: Record<string, T>) {
  for (const id in backlog) if (!(id in incoming)) delete backlog[id];
  for (const id in incoming) {
    const cur = backlog[id];
    if (cur) Object.assign(cur, incoming[id]);
    else backlog[id] = { ...incoming[id] };
  }
}

const WS_BASE_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080';
// Stable per-browser id sent on connect so the server can restore a
// previous session's name/class/level/progress -- see
// server/src/GameServer.js onConnection / _restoreAndGreet.
const WS_URL = `${WS_BASE_URL}?clientId=${getOrCreateClientId()}`;

const DENY_REASON_TEXT: Record<string, string> = {
  not_equipped: 'Spell not equipped',
  unknown_spell: 'Unknown spell',
  not_alive: "Can't cast while dead",
  wrong_class: 'Wrong class for that spell',
  on_cooldown: 'Still on cooldown',
  not_enough_mana: 'Not enough mana',
  domain_active: 'Another domain is already active',
  used_this_life: 'Already used this life',
  no_recent_damage: 'No recent damage on target',
  target_not_frozen: 'Target is not frozen',
  stunned: "Can't cast while stunned",
  casting: 'Already casting',
  invalid_target: 'No valid target',
  out_of_range: 'Target out of range',
  no_line_of_sight: 'No line of sight to target',
};

export default function App() {
  const clockSync = useRef(new ClockSync());
  const ws = useRef(new WebSocketClient(WS_URL, clockSync.current));
  const prediction = useRef(new ClientPrediction());
  const interpolation = useRef(new EntityInterpolation());
  const lastReactSyncRef = useRef(0);
  // Delta-tick partials accumulated since the last React sync, see the GAME_TICK handler.
  const pendingTick = useRef<{ players: Record<string, PlayerState>; projectiles: Record<string, ProjectileState> } | null>(null);
  // Set when the socket drops mid-lobby-game, consumed by the next ROOM_JOINED
  // (the fresh connection lands on the main menu with no room) to drop the
  // player straight back into the arena with the class they had.
  const rejoinRef = useRef<{ cls: WizardClass; username: string } | null>(null);

  const [showPauseMenu, setShowPauseMenu] = useState(false);
  // Which pause menu tab is showing -- lifted up here (rather than owned
  // internally by PauseMenu) so the Tab key can jump straight to the Skill
  // Tree tab even while the menu is already open on something else, and so
  // Escape reopens on whatever tab was last visible.
  const [pauseMenuTab, setPauseMenuTab] = useState<'spells' | 'tree' | 'glossary' | 'settings'>('spells');
  const [showExperimentLab, setShowExperimentLab] = useState(false);
  const [showDesignLab, setShowDesignLab] = useState(false);
  // Set by ModeSelect/DuelSelect, consumed by ClassSelect -- see onClassSelected below.
  const [pendingMode, setPendingMode] = useState<string | null>(null);
  const [pendingOpponentId, setPendingOpponentId] = useState<string | null>(null);

  // Mirror of "a lab overlay is open" for the long-lived keydown listener below (its effect has no deps).
  const labOpenRef = useRef(false);
  useEffect(() => { labOpenRef.current = showExperimentLab || showDesignLab; }, [showExperimentLab, showDesignLab]);

  // Must be declared before the useEffect that depends on it
  const phase = useGameStore((s) => s.phase);

  const voteState = useGameStore((s) => s.voteState);
  const connected = useNetworkStore((s) => s.connected);
  const replaced = useNetworkStore((s) => s.replaced);

  // Keep the store flag in sync so CameraController can block inputs. Only
  // the once-per-life fork vote blocks -- the player is hidden and frozen
  // server-side for its duration (see Room.processInput's isChoosingBranch
  // check), so local input needs to stop too. An ordinary point-spend prompt
  // (voteState.blocking === false) is a light, non-blocking corner nudge and
  // must NOT freeze the camera/movement.
  useEffect(() => {
    const menuPhase = phase === 'class_select' || phase === 'connecting' || phase === 'main_menu' || phase === 'mode_select' || phase === 'duel_select' || phase === 'match_end';
    const blocking = showPauseMenu || showExperimentLab || showDesignLab || menuPhase || voteState?.blocking === true;
    useGameStore.getState().setMenuOpen(blocking);
  }, [showPauseMenu, showExperimentLab, showDesignLab, phase, voteState]);

  // Back at the main menu means no room (see MatchEndScreen/LEAVE_ROOM), so no more
  // ticks will refresh local.isAlive. After a VICTORY it would still read `true`, and
  // CameraController only snaps the camera to the spawn point on a false -> true
  // isAlive transition -- so the next match would start with the camera (and the
  // predicted position) left at the old arena coordinates until reconciliation
  // dragged it over. Clearing it here makes the next PLAYER_RESPAWNED a real transition.
  useEffect(() => {
    if (phase === 'main_menu') useGameStore.getState().setLocalAlive(false);
  }, [phase]);

  // Music bed: pause menu wins over everything, then the menu flow, then the
  // death sting (on the death screen and a DEFEATED match end). The sting is
  // one-shot per screen -- closing the pause menu while still dead goes
  // silent rather than replaying it.
  const stingPlayedForPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    // matchResult is always set before phase flips to 'match_end' (see the
    // MATCH_END handler), so reading it here is safe without subscribing.
    const { matchResult, local } = useGameStore.getState();
    const defeated = phase === 'match_end' && matchResult?.winningTeam != null && matchResult.winningTeam !== local.team;
    const stingPhase = phase === 'dead' || defeated;
    if (!stingPhase) stingPlayedForPhaseRef.current = null;
    const inMainMenu = phase === 'main_menu' || phase === 'mode_select' || phase === 'duel_select' || phase === 'class_select' || phase === 'connecting';
    if (showPauseMenu) {
      audioManager.playMusic('music_pause');
    } else if (inMainMenu) {
      audioManager.playMusic('music_menu');
    } else if (stingPhase && stingPlayedForPhaseRef.current !== phase) {
      stingPlayedForPhaseRef.current = phase;
      // Stop first so dying straight into a defeat restarts the sting rather
      // than no-oping on the same track id.
      audioManager.stopMusic(150);
      audioManager.playMusic('music_death', { fadeMs: 150 });
    } else {
      audioManager.stopMusic();
    }
  }, [phase, showPauseMenu]);

  const {
    setPhase, applyTick, setLocalClass, addKillFeedEntry, setLocalAlive, setLocalPosition, spawnDamageNumber,
    pushNotification, setVoteState, setLastDeath, setMatchActive, setMatchResult, setMatchCountdownEndsAt,
  } = useGameStore.getState();
  const { setLocalPlayerId, setRoomId, setRestoredUsername, setRestoredClass, setElo } = useNetworkStore.getState();

  useEffect(() => {
    const wsClient = ws.current;
    wsClient.connect();
    // Dev-only handle for automated playtests (scripts/playtest/browser-playtest.mjs).
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__ws = wsClient;

    // A fresh socket is a fresh timeline: the old in-flight input history,
    // interpolation buffers and clock baseline all belong to a server session
    // that no longer exists (the new connection is a new Player, not resumed
    // mid-sim), and replaying/interpolating against them produces garbage.
    const offOpen = wsClient.onOpen((isReconnect) => {
      if (!isReconnect) return;
      prediction.current.reset();
      interpolation.current.clear();
    });
    const offClose = wsClient.onClose(() => {
      prediction.current.reset();
      const { phase: p, local } = useGameStore.getState();
      if ((p === 'playing' || p === 'dead') && local.class && useNetworkStore.getState().roomId === 'lobby') {
        rejoinRef.current = { cls: local.class, username: local.username };
      }
    });

    // ── Server messages ───────────────────────────────────────────────────

    const offJoined = wsClient.on(S2C.ROOM_JOINED, (msg) => {
      const playerId = msg.playerId as string;
      const restoredClass = msg.class as WizardClass | null;
      const restoredUsername = msg.username as string | null;
      setLocalPlayerId(playerId);

      // ROOM_JOINED is also what a RECONNECT greets us with (the server tore down
      // our old Player when the socket dropped, so whatever match/room we were in
      // is gone and we're a fresh, room-less Player). Drop every piece of
      // in-game client state tied to the old session before landing on the menu,
      // otherwise the old arena's players/projectiles keep rendering behind the
      // menu, the pause menu / labs stay open on top of it, a pending fork-vote
      // keeps menuOpen latched, and matchActive makes the next death screen think
      // it's still inside the vanished match.
      if (useGameStore.getState().phase !== 'connecting') {
        setShowPauseMenu(false);
        setShowExperimentLab(false);
        setShowDesignLab(false);
        setPendingMode(null);
        setPendingOpponentId(null);
        setVoteState(null);
        setMatchActive(false);
        setMatchResult(null);
        setMatchCountdownEndsAt(null);
        setLocalAlive(false);
        useGameStore.setState({
          players: {}, projectiles: {}, effects: {}, domains: {}, barriers: {},
          chargingSpell: null, serverCorrectedPos: null, spawnYaw: null, lastDeath: null,
          // Debug mode is per server-side Player; the fresh one made by the reconnect starts with it off.
          debugMode: false, birdsEyeView: false,
        });
        interpolation.current.prune(new Set());
        if (document.pointerLockElement) document.exitPointerLock();
      }

      // Land on the main menu first regardless of session state -- neither
      // branch here joins a room or picks a class anymore, that's deferred
      // to whichever menu button the player actually clicks (see
      // onMultiplayer/onSinglePlayer below). A resumed session's saved
      // class/username are stashed for onMultiplayer to pick up so clicking
      // Multiplayer can still drop straight back into the arena.
      if (restoredClass) setRestoredClass(restoredClass);
      if (restoredUsername) setRestoredUsername(restoredUsername);
      if (typeof msg.elo === 'number') setElo(msg.elo);

      // Reconnected mid-game: rejoin the lobby rather than dumping the player
      // on the main menu. A restored session (Redis) keeps its class/progress
      // and respawns on JOIN_ROOM; otherwise pick the previous class again.
      const rejoin = rejoinRef.current;
      if (rejoin) {
        rejoinRef.current = null;
        wsClient.send(C2S.JOIN_ROOM, { roomId: 'lobby', username: rejoin.username || restoredUsername || `Wizard_${playerId.slice(0, 4)}` });
        if (!restoredClass) wsClient.send(C2S.SELECT_CLASS, { class: rejoin.cls, username: rejoin.username || undefined });
        return;
      }
      setPhase('main_menu');
    });

    const offMatchCountdown = wsClient.on(S2C.MATCH_COUNTDOWN, (msg) => {
      setMatchCountdownEndsAt(msg.endsAt as number);
    });

    const offMatchEnd = wsClient.on(S2C.MATCH_END, (msg) => {
      setMatchActive(false);
      const elo = msg.elo as { eloBefore: number; eloAfter: number; eloDelta: number; opponentElo: number } | null;
      if (elo) setElo(elo.eloAfter);
      setMatchResult({
        winningTeam: (msg.winningTeam as number | null) ?? null,
        standings: (msg.standings as number[] | undefined) ?? [],
        players: (msg.players as MatchResultPlayer[] | undefined) ?? [],
        elo: elo ?? null,
      });
      setPhase('match_end');
    });

    const offRoomState = wsClient.on(S2C.ROOM_STATE, (msg) => {
      const payload = msg as unknown as GameTickPayload;
      const localId = useNetworkStore.getState().localPlayerId ?? '';
      // ROOM_STATE is a full snapshot: replace, and drop any delta backlog.
      pendingTick.current = null;
      applyTick(payload.players, payload.projectiles, payload.effects, payload.domains, payload.barriers, payload.tick, payload.timestamp, localId, false);
      setRoomId(msg.roomId as string);
    });

    const offTick = wsClient.on(S2C.GAME_TICK, (msg) => {
      const payload = msg as unknown as GameTickPayload;
      const localId = useNetworkStore.getState().localPlayerId ?? '';
      expandTickPayload(payload, localId);

      // Reconcile client prediction and push corrected position for CameraController to blend
      const serverPlayer = payload.players[localId];
      if (serverPlayer) {
        const barrierCircles = Object.values(payload.barriers ?? {})
          .filter((b) => b.active)
          .map((b) => ({ x: b.position.x, z: b.position.z, radius: b.width / 2 }));
        // Replay the unacked inputs from the server's own velocity (falls back
        // to our recorded post-ack velocity when the server doesn't send it);
        // CameraController picks the result up once per frame.
        prediction.current.reconcile(serverPlayer.position, payload.ackSeq, serverPlayer.velocity, barrierCircles);
      }
      netDebug.onTick();
      interpolation.current.onTick(payload.timestamp);

      // Feed remote players into interpolation -- every tick (64Hz), independent
      // of the throttled React sync below, so remote-entity motion stays smooth.
      for (const [pid, pstate] of Object.entries(payload.players)) {
        if (pid !== localId) {
          interpolation.current.record(pid, payload.timestamp, pstate);
        }
      }
      interpolation.current.prune(new Set(Object.keys(payload.players)));

      // Sync to the React store at REACT_SYNC_HZ instead of every 64Hz tick.
      // applyTick replaces players/projectiles/effects/domains/barriers with
      // new object references every call, so anything subscribed to those
      // slices (Scene, SpellRenderer, HUD) re-rendered on every single tick
      // regardless of whether anything visible changed -- that reconciliation
      // work was competing with r3f's render loop for the main thread and was
      // the actual cause of janky movement (reproduces on localhost, since
      // it's not network-driven at all). Nothing that needs full-tick
      // precision reads from here: own position is local-predicted, remote
      // players come from the interpolation buffer above, and projectiles
      // integrate their own velocity per frame.
      //
      // Delta payloads carry cold player fields and projectile statics only
      // on the tick they change, so ticks skipped by this throttle must not
      // lose them: fold every tick's partials into a backlog and hand the
      // accumulated result to applyTick at sync time.
      if (payload.delta) {
        const pending = pendingTick.current ?? (pendingTick.current = { players: {}, projectiles: {} });
        accumulate(pending.players, payload.players);
        accumulate(pending.projectiles, payload.projectiles);
      } else {
        pendingTick.current = null;
      }
      const now = performance.now();
      if (now - lastReactSyncRef.current >= REACT_SYNC_INTERVAL_MS) {
        lastReactSyncRef.current = now;
        const pending = pendingTick.current;
        pendingTick.current = null;
        applyTick(
          pending ? pending.players : payload.players,
          pending ? pending.projectiles : payload.projectiles,
          payload.effects, payload.domains, payload.barriers, payload.tick, payload.timestamp, localId, !!pending,
        );
      }
    });

    const offHitConfirmed = wsClient.on(S2C.HIT_CONFIRMED, (msg) => {
      const targetId = msg.targetId as string;
      const damage = msg.damage as number;
      const isHeadshot = !!msg.isHeadshot;
      if (!damage || damage <= 0) return;
      const target = useGameStore.getState().players[targetId];
      if (target) {
        spawnDamageNumber(target.position.x, target.position.y, target.position.z, Math.round(damage), isHeadshot);
      }
    });

    const offLevelUp = wsClient.on(S2C.LEVEL_UP, (msg) => {
      const level = msg.level as number;
      const rank = msg.rank as string;
      const isNewRank = RANKS.find((r) => r.minLevel === level)?.name === rank;
      pushNotification(isNewRank ? `${rank} — Level ${level}` : `Level ${level}`, '#ffcc00');
      audioManager.playSound(isNewRank ? 'rank_up' : 'level_up');
      if (msg.hatGrew) {
        pushNotification('Your hat grew!', '#ffaa44');
        audioManager.playSound('hat_tier_up');
      }
    });

    const offHatBuff = wsClient.on(S2C.HAT_BUFF_PROC, (msg) => {
      const pct = Math.round((msg.damageMult as number) * 100);
      pushNotification(`Hat knocked askew! +${pct}% damage`, '#ffaa44');
      audioManager.playSound('hat_buff_proc');
    });

    const offVotePrompt = wsClient.on(S2C.SKILL_VOTE_PROMPT, (msg) => {
      setVoteState({
        promptId: msg.promptId as string,
        branchGroup: (msg.branchGroup as string | null) ?? null,
        options: msg.options as { id: string; label: string; description: string }[],
        blocking: !!msg.blocking,
      });
      audioManager.playSound('vote_open');
    });

    const offAutoUnlocked = wsClient.on(S2C.SKILL_AUTO_UNLOCKED, (msg) => {
      const label = msg.label as string;
      const equip = msg.equip as { slotIndex: number; replacedSpellId: string | null } | null;
      setVoteState(null);
      if (equip) {
        const replaced = equip.replacedSpellId ? getSpell(equip.replacedSpellId) : null;
        pushNotification(
          replaced ? `${label} auto-equipped, replacing ${replaced.name}` : `${label} auto-equipped`,
          '#66ddaa',
        );
        audioManager.playSound('auto_equip_swap');
      } else {
        pushNotification(`${label} unlocked`, '#66ddaa');
        audioManager.playSound('spell_unlocked');
      }
    });

    const offCastDenied = wsClient.on(S2C.SPELL_CAST_DENIED, (msg) => {
      const reason = msg.reason as string;
      const text = DENY_REASON_TEXT[reason] ?? 'Cast failed';
      pushNotification(text, '#ff6666');
      audioManager.playSound('cast_denied');
    });

    const offKillFeed = wsClient.on(S2C.KILL_FEED, (msg) => {
      addKillFeedEntry({
        killer: msg.killer as string,
        killerSymbol: msg.killerSymbol as string | undefined,
        victim: msg.victim as string,
        victimSymbol: msg.victimSymbol as string | undefined,
        spellId: msg.spellId as string | null,
        at: Date.now(),
      });
    });

    const offDied = wsClient.on(S2C.PLAYER_DIED, (msg) => {
      const localId = useNetworkStore.getState().localPlayerId;
      if (msg.playerId === localId) {
        setLocalAlive(false);
        setPhase('dead');
        setLastDeath({
          killerName: (msg.killerName as string | null) ?? null,
          killerSymbol: (msg.killerSymbol as string | null) ?? null,
          spellId: (msg.spellId as string | null) ?? null,
        });
        audioManager.playSound('death_generic');
      }
    });

    const offRespawned = wsClient.on(S2C.PLAYER_RESPAWNED, (msg) => {
      const localId = useNetworkStore.getState().localPlayerId;
      if (msg.playerId === localId) {
        // Sync camera to actual spawn position before prediction takes over
        if (msg.position) setLocalPosition(msg.position as { x: number; y: number; z: number });
        prediction.current.reset(); // pre-respawn inputs describe a body that no longer exists
        // Match spawns pick a facing (toward the opponent/arena center --
        // see Room.setupMatch/setupDuel) instead of leaving the camera
        // pointed wherever it last happened to look; consumed by CameraController.
        if (typeof msg.yaw === 'number') useGameStore.setState({ spawnYaw: msg.yaw });
        setLocalAlive(true);
        setPhase('playing');
        audioManager.playSound('respawn_materialize');
      }
    });

    // Keyboard: both Tab and Escape open the pause menu -- Tab jumps straight
    // to its Skill Tree tab, Escape just toggles it open/closed on whatever
    // tab was last showing.
    const onKeyDown = (e: KeyboardEvent) => {
      const p = useGameStore.getState().phase;
      // A lab overlay (z-index above the pause menu) owns the keyboard while it's open:
      // Escape closes it, and neither key may queue a pause menu up underneath it
      // (which then popped into view the moment the lab closed).
      if (labOpenRef.current) {
        if (e.code === 'Escape') { setShowExperimentLab(false); setShowDesignLab(false); }
        if (e.code === 'Tab') e.preventDefault();
        return;
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        if (p === 'playing' || p === 'dead') {
          setPauseMenuTab('tree');
          setShowPauseMenu(true);
        }
      }
      if (e.code === 'Escape') {
        if (p === 'playing' || p === 'dead') {
          setShowPauseMenu(prev => !prev);
        } else {
          setShowPauseMenu(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // Chrome suppresses the Escape keydown when it exits pointer lock, so the
    // keydown handler above never fires on the first press. Instead, listen for
    // the lock-release event and open the menu directly.
    const onPointerLockChange = () => {
      if (!document.pointerLockElement && !labOpenRef.current) {
        const p = useGameStore.getState().phase;
        // The fork-choice screen (SkillVotePrompt) deliberately releases
        // pointer lock itself when it opens so the cursor is visible to
        // click an option -- without this guard, that release looked
        // identical to the player pressing Escape, so picking a fork
        // silently queued the pause menu open underneath it (invisible
        // behind the higher z-index fork screen) and it popped the instant
        // the fork screen unmounted.
        if ((p === 'playing' || p === 'dead') && !useGameStore.getState().voteState?.blocking) {
          setShowPauseMenu(true);
        }
      }
    };
    document.addEventListener('pointerlockchange', onPointerLockChange);

    // Cooldown tick
    const cdInterval = setInterval(() => {
      useGameStore.getState().tickLocalCooldowns();
    }, 16);

    return () => {
      offOpen();
      offClose();
      offJoined();
      offMatchCountdown();
      offMatchEnd();
      offRoomState();
      offTick();
      offHitConfirmed();
      offLevelUp();
      offHatBuff();
      offVotePrompt();
      offAutoUnlocked();
      offCastDenied();
      offKillFeed();
      offDied();
      offRespawned();
      wsClient.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      clearInterval(cdInterval);
    };
  }, []);

  function onClassSelected(c: WizardClass) {
    setLocalClass(c);
    setPhase('playing');
    if (pendingMode) {
      // ClassSelect already sent C2S.START_MATCH instead of SELECT_CLASS
      // when pendingMode is set -- see its `pendingMode`/`pendingOpponentId` props.
      useGameStore.getState().setMatchActive(true);
      setPendingMode(null);
      setPendingOpponentId(null);
    }
  }

  function onMultiplayer() {
    const { restoredClass, restoredUsername, localPlayerId } = useNetworkStore.getState();
    if (restoredClass) {
      // Resumed session (see server/src/GameServer.js _restoreAndGreet):
      // same name/class/level/progress as before the disconnect -- join
      // straight back into the arena instead of re-picking a class.
      setLocalClass(restoredClass);
      ws.current.send(C2S.JOIN_ROOM, { roomId: 'lobby' });
    } else {
      const playerId = localPlayerId ?? '';
      ws.current.send(C2S.JOIN_ROOM, { roomId: 'lobby', username: restoredUsername ?? `Wizard_${playerId.slice(0, 4)}` });
      setPhase('class_select');
    }
  }

  function onSinglePlayer() {
    setPendingMode(null);
    setPendingOpponentId(null);
    setPhase('mode_select');
  }

  function onPickMode(modeId: string) {
    if (modeId === 'duel1v1') {
      // 1v1 needs an opponent picked first -- see DuelSelect.
      setPendingMode(modeId);
      setPhase('duel_select');
      return;
    }
    setPendingMode(modeId);
    setPhase('class_select');
  }

  function onPickOpponent(opponentId: string) {
    setPendingOpponentId(opponentId);
    setPhase('class_select');
  }

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#050508' }}>
      {/* 3D scene always mounted (avoids re-mounting Three.js context) */}
      <Scene
        ws={ws.current}
        prediction={prediction.current}
        interpolation={interpolation.current}
      />

      {/* 2D overlay UI */}
      <HUD ws={ws.current} />
      <NotificationFeed />
      <MatchCountdown />
      {phase === 'playing' && <SkillVotePrompt ws={ws.current} />}
      {phase === 'dead' && <DeathScreen ws={ws.current} />}
      {phase === 'match_end' && <MatchEndScreen ws={ws.current} />}

      {/* Landing screen: Single Player / Multiplayer */}
      {phase === 'main_menu' && (
        <MainMenu onSinglePlayer={onSinglePlayer} onMultiplayer={onMultiplayer} />
      )}

      {/* Single Player: bot game-mode picker */}
      {phase === 'mode_select' && (
        <ModeSelect onPick={onPickMode} onBack={() => setPhase('main_menu')} />
      )}

      {/* Single Player 1v1: opponent picker, staking ELO on the outcome */}
      {phase === 'duel_select' && (
        <DuelSelect onPick={onPickOpponent} onBack={() => { setPendingMode(null); setPhase('mode_select'); }} />
      )}

      {/* Class selection (blocks scene interaction until chosen) */}
      {phase === 'class_select' && (
        <ClassSelect ws={ws.current} onSelected={onClassSelected} pendingMode={pendingMode} pendingOpponentId={pendingOpponentId} />
      )}

      {/* Mid-session connection loss: the socket auto-reconnects (see WebSocketClient),
          but until it does the world silently freezes -- say so. Non-blocking. */}
      {!connected && phase !== 'connecting' && (
        <div style={{
          position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 900,
          padding: '6px 18px', background: 'rgba(120,20,20,0.85)', border: '1px solid #cc4444',
          color: '#ffdddd', fontSize: 12, letterSpacing: 3, textTransform: 'uppercase', pointerEvents: 'none',
        }}>
          {replaced ? 'Opened in another tab - reload to play here' : 'Connection lost - reconnecting...'}
        </div>
      )}

      {/* Connecting overlay */}
      {phase === 'connecting' && (
        <div style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#050508',
          color: '#bbbbdd',
          letterSpacing: 6,
          fontSize: 15,
          textTransform: 'uppercase',
        }}>
          Connecting...
        </div>
      )}

      {/* Pause menu overlay -- includes the Skill Tree as one of its tabs */}
      {showPauseMenu && (
        <PauseMenu
          ws={ws.current}
          onClose={() => setShowPauseMenu(false)}
          tab={pauseMenuTab}
          onTabChange={setPauseMenuTab}
          experimentLabAvailable={IS_LOCALHOST}
          onOpenExperimentLab={() => {
            setShowPauseMenu(false);
            ws.current.send(C2S.JOIN_ROOM, { experiment: true, username: `Wizard_${(useNetworkStore.getState().localPlayerId ?? '').slice(0, 4)}` });
            setShowExperimentLab(true);
          }}
          designLabAvailable={IS_LOCALHOST}
          onOpenDesignLab={() => {
            setShowPauseMenu(false);
            setShowDesignLab(true);
          }}
        />
      )}

      {/* Experiment Lab overlay (localhost only) */}
      {showExperimentLab && (
        <ExperimentLab
          ws={ws.current}
          onClose={() => setShowExperimentLab(false)}
          onReturnToLobby={() => {
            setShowExperimentLab(false);
            ws.current.send(C2S.JOIN_ROOM, { roomId: 'lobby', username: `Wizard_${(useNetworkStore.getState().localPlayerId ?? '').slice(0, 4)}` });
          }}
        />
      )}

      {/* Design Lab overlay (localhost only) -- card look generator + bank */}
      {showDesignLab && (
        <DesignLab ws={ws.current} onClose={() => setShowDesignLab(false)} />
      )}
    </div>
  );
}
