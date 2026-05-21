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
import { S2C, C2S } from 'shared/events';
import type { GameTickPayload, WizardClass } from './types/game.types';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080';

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
      }
    });

    const offRespawned = wsClient.on(S2C.PLAYER_RESPAWNED, (msg) => {
      const localId = useNetworkStore.getState().localPlayerId;
      if (msg.playerId === localId) {
        // Sync camera to actual spawn position before prediction takes over
        if (msg.position) setLocalPosition(msg.position as { x: number; y: number; z: number });
        setLocalAlive(true);
        setPhase('playing');
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
