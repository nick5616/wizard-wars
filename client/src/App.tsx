/**
 * App root. Owns the WebSocket client, networking singletons, and
 * dispatches server messages to the game store.
 */

import { useEffect, useRef, useState } from 'react';
import { WebSocketClient } from './networking/WebSocketClient';
import { ClockSync } from './networking/ClockSync';
import { ClientPrediction } from './networking/ClientPrediction';
import { EntityInterpolation } from './networking/EntityInterpolation';
import { useGameStore } from './stores/gameStore';
import { useNetworkStore } from './stores/networkStore';
import { Scene } from './components/core/Scene';
import { HUD } from './components/ui/HUD';
import { ClassSelect } from './components/ui/ClassSelect';
import { SkillTree } from './components/ui/SkillTree';
import { PauseMenu } from './components/ui/PauseMenu';
import { NotificationFeed } from './components/ui/NotificationFeed';
import { SkillVotePrompt } from './components/ui/SkillVotePrompt';
import { DeathScreen } from './components/ui/DeathScreen';
import { audioManager } from './audio/AudioManager';
import { getSpell } from 'shared/spells';
import { S2C, C2S } from 'shared/events';
import { RANKS } from 'shared/leveling';
import type { GameTickPayload, WizardClass } from './types/game.types';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080';

const DENY_REASON_TEXT: Record<string, string> = {
  not_equipped: 'Spell not equipped',
  unknown_spell: 'Unknown spell',
  not_alive: "Can't cast while dead",
  wrong_class: 'Wrong class for that spell',
  on_cooldown: 'Still on cooldown',
  domain_active: 'Another domain is already active',
  used_this_life: 'Already used this life',
  no_recent_damage: 'No recent damage on target',
  target_not_frozen: 'Target is not frozen',
};

export default function App() {
  const clockSync = useRef(new ClockSync());
  const ws = useRef(new WebSocketClient(WS_URL, clockSync.current));
  const prediction = useRef(new ClientPrediction());
  const interpolation = useRef(new EntityInterpolation());

  const [showSkillTree, setShowSkillTree] = useState(false);
  const [showPauseMenu, setShowPauseMenu] = useState(false);

  // Must be declared before the useEffect that depends on it
  const phase = useGameStore((s) => s.phase);

  // Keep the store flag in sync so CameraController can block inputs
  useEffect(() => {
    const blocking = showSkillTree || showPauseMenu || phase === 'class_select' || phase === 'connecting';
    useGameStore.getState().setMenuOpen(blocking);
  }, [showSkillTree, showPauseMenu, phase]);
  const {
    setPhase, applyTick, setLocalClass, addKillFeedEntry, setLocalAlive, setLocalPosition, spawnDamageNumber,
    pushNotification, setVoteState,
  } = useGameStore.getState();
  const { setLocalPlayerId, setRoomId } = useNetworkStore.getState();

  useEffect(() => {
    const wsClient = ws.current;
    wsClient.connect();

    // ── Server messages ───────────────────────────────────────────────────

    const offJoined = wsClient.on(S2C.ROOM_JOINED, (msg) => {
      const playerId = msg.playerId as string;
      setLocalPlayerId(playerId);
      // Join the default lobby room
      wsClient.send(C2S.JOIN_ROOM, { roomId: 'lobby', username: `Wizard_${playerId.slice(0, 4)}` });
      setPhase('class_select');
    });

    const offRoomState = wsClient.on(S2C.ROOM_STATE, (msg) => {
      const payload = msg as unknown as GameTickPayload;
      const localId = useNetworkStore.getState().localPlayerId ?? '';
      applyTick(payload.players, payload.projectiles, payload.effects, payload.domains, payload.tick, payload.timestamp, localId);
      setRoomId(msg.roomId as string);
    });

    const offTick = wsClient.on(S2C.GAME_TICK, (msg) => {
      const payload = msg as unknown as GameTickPayload;
      const localId = useNetworkStore.getState().localPlayerId ?? '';

      // Reconcile client prediction and push corrected position for CameraController to blend
      const serverPlayer = payload.players[localId];
      if (serverPlayer) {
        const vel = { x: 0, y: 0, z: 0 };
        const corrected = prediction.current.reconcile(serverPlayer.position, payload.ackSeq, vel);
        useGameStore.setState({ serverCorrectedPos: corrected });
      }

      // Feed remote players into interpolation
      for (const [pid, pstate] of Object.entries(payload.players)) {
        if (pid !== localId) {
          interpolation.current.record(pid, payload.timestamp, pstate);
        }
      }

      applyTick(payload.players, payload.projectiles, payload.effects, payload.domains, payload.tick, payload.timestamp, localId);

      // Prune disconnected players from interpolation
      interpolation.current.prune(new Set(Object.keys(payload.players)));
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
      const timeoutMs = msg.timeoutMs as number;
      setVoteState({
        branchGroup: msg.branchGroup as string,
        options: msg.options as { id: string; label: string; description: string }[],
        expiresAt: Date.now() + timeoutMs,
        totalMs: timeoutMs,
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
        victim: msg.victim as string,
        spellId: msg.spellId as string | null,
        at: Date.now(),
      });
    });

    const offDied = wsClient.on(S2C.PLAYER_DIED, (msg) => {
      const localId = useNetworkStore.getState().localPlayerId;
      if (msg.playerId === localId) {
        setLocalAlive(false);
        setPhase('dead');
        audioManager.playSound('death_generic');
      }
    });

    const offRespawned = wsClient.on(S2C.PLAYER_RESPAWNED, (msg) => {
      const localId = useNetworkStore.getState().localPlayerId;
      if (msg.playerId === localId) {
        // Sync camera to actual spawn position before prediction takes over
        if (msg.position) setLocalPosition(msg.position as { x: number; y: number; z: number });
        setLocalAlive(true);
        setPhase('playing');
        audioManager.playSound('respawn_materialize');
      }
    });

    // Keyboard: Tab → skill tree, Escape → pause menu
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        const p = useGameStore.getState().phase;
        if (p === 'playing' || p === 'skill_tree') {
          setShowSkillTree(prev => !prev);
          setShowPauseMenu(false);
        }
      }
      if (e.code === 'Escape') {
        setShowSkillTree(false);
        const p = useGameStore.getState().phase;
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
      if (!document.pointerLockElement) {
        const p = useGameStore.getState().phase;
        if (p === 'playing' || p === 'dead') {
          setShowPauseMenu(true);
          setShowSkillTree(false);
        }
      }
    };
    document.addEventListener('pointerlockchange', onPointerLockChange);

    // Cooldown tick
    const cdInterval = setInterval(() => {
      useGameStore.getState().tickLocalCooldowns();
    }, 16);

    return () => {
      offJoined();
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
      <HUD />
      <NotificationFeed />
      {phase === 'playing' && <SkillVotePrompt ws={ws.current} />}
      {phase === 'dead' && <DeathScreen ws={ws.current} />}

      {/* Class selection (blocks scene interaction until chosen) */}
      {phase === 'class_select' && (
        <ClassSelect ws={ws.current} onSelected={onClassSelected} />
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

      {/* Skill tree overlay */}
      {showSkillTree && (
        <SkillTree ws={ws.current} onClose={() => setShowSkillTree(false)} />
      )}

      {/* Pause menu overlay */}
      {showPauseMenu && (
        <PauseMenu ws={ws.current} onClose={() => setShowPauseMenu(false)} />
      )}
    </div>
  );
}
