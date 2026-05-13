/**
 * First-person camera controller for wizard game.
 * Handles mouse look + sends inputs to server via WebSocket.
 * Applies client-side prediction for movement.
 */

import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useKeyboardControls } from '../../hooks/useKeyboardControls';
import { useMouseControls } from '../../hooks/useMouseControls';
import { useGameStore } from '../../stores/gameStore';
import { useNetworkStore } from '../../stores/networkStore';
import { ClientPrediction } from '../../networking/ClientPrediction';
import type { Vec3 } from '../../types/game.types';
import { INPUT_FLAGS } from 'shared/events';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import { C2S } from 'shared/events';
import { PLAYER_HEIGHT } from 'shared/constants';
import { MOBILITY_SPELL, getSpell } from 'shared/spells';

const MOUSE_SENSITIVITY = 0.002;

interface Props {
  ws: WebSocketClient;
  prediction: ClientPrediction;
}

export function CameraController({ ws, prediction }: Props) {
  const { camera } = useThree();
  const { movement, activeSlot } = useKeyboardControls();
  const { isLocked, consumeDelta, lmbRef } = useMouseControls();
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const posRef = useRef({ x: 0, y: PLAYER_HEIGHT, z: 0 });
  const velRef = useRef({ x: 0, y: 0, z: 0 });
  const inputTickRef = useRef(0);
  const lastCastRef = useRef(false);
  const wasAliveRef = useRef(false);
  const wasShiftRef = useRef(false);

  const { local, setLocalPosition } = useGameStore.getState();
  const { localPlayerId } = useNetworkStore.getState();

  // Sync camera to initial position
  useEffect(() => {
    camera.position.set(posRef.current.x, posRef.current.y, posRef.current.z);
  }, [camera]);

  // Scroll wheel: switch active spell slot.
  // Trackpad fires many small deltaY events; accumulate until threshold to avoid
  // over-scrolling. A physical mouse wheel fires large discrete steps (typically
  // 100+ on Windows, 3 notches on Mac). Threshold of 60 lets one mouse click
  // = one slot, while a trackpad swipe needs a deliberate flick.
  useEffect(() => {
    let accumulated = 0;
    const THRESHOLD = 60;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (useGameStore.getState().menuOpen) return;
      accumulated += e.deltaY;
      if (Math.abs(accumulated) < THRESHOLD) return;
      const dir = accumulated > 0 ? 1 : -1;
      accumulated = 0;
      const { local, setActiveSlot } = useGameStore.getState();
      const slots = local.equippedSpells;
      const numSlots = slots.length;
      // Skip empty slots — find the next filled slot in the scroll direction
      let next = local.activeSlot;
      for (let i = 1; i <= numSlots; i++) {
        const candidate = ((local.activeSlot + dir * i) + numSlots) % numSlots;
        if (slots[candidate] !== null) { next = candidate; break; }
      }
      if (next !== local.activeSlot) setActiveSlot(next);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const { local, setLocalPosition, serverCorrectedPos, menuOpen } = useGameStore.getState();

    // While any menu is open: freeze all game input (no look, no move, no cast)
    if (menuOpen) return;
    const { localPlayerId } = useNetworkStore.getState();

    // On spawn/respawn: snap camera to the server-provided position so projectiles
    // originate from the right place instead of wherever the camera happened to be.
    if (local.isAlive && !wasAliveRef.current) {
      posRef.current = { ...local.position };
      velRef.current = { x: 0, y: 0, z: 0 };
    }
    wasAliveRef.current = local.isAlive;

    if (!local.isAlive) return;

    // Apply server reconciliation correction and clear it
    if (serverCorrectedPos) {
      posRef.current = ClientPrediction.blendCorrection(posRef.current, serverCorrectedPos);
      useGameStore.setState({ serverCorrectedPos: null });
    }

    // ── Mouse look ──────────────────────────────────────────────────────────
    if (isLocked) {
      const d = consumeDelta();
      yawRef.current -= d.x * MOUSE_SENSITIVITY;
      pitchRef.current = Math.max(
        -Math.PI / 2 + 0.01,
        Math.min(Math.PI / 2 - 0.01, pitchRef.current - d.y * MOUSE_SENSITIVITY),
      );
      euler.current.set(pitchRef.current, yawRef.current, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler.current);
    }

    // ── Client-side prediction ──────────────────────────────────────────────
    let flags = 0;
    if (movement.forward)  flags |= INPUT_FLAGS.FORWARD;
    if (movement.backward) flags |= INPUT_FLAGS.BACKWARD;
    if (movement.left)     flags |= INPUT_FLAGS.LEFT;
    if (movement.right)    flags |= INPUT_FLAGS.RIGHT;
    if (movement.jumping)  flags |= INPUT_FLAGS.JUMP;
    if (movement.mobility) flags |= INPUT_FLAGS.MOBILITY;

    const result = prediction.predict(posRef.current, velRef.current, flags, yawRef.current, dt);
    posRef.current = result.pos;
    velRef.current = result.vel;

    camera.position.set(result.pos.x, result.pos.y + 0.1, result.pos.z);
    setLocalPosition(result.pos);

    // ── Send input to server at 64Hz ────────────────────────────────────────
    inputTickRef.current += dt;
    if (inputTickRef.current >= 1 / 64) {
      inputTickRef.current -= 1 / 64;

      const lmbDown = lmbRef.current;
      let cast = null;

      // Cast on LMB press (edge trigger)
      if (lmbDown && !lastCastRef.current) {
        const spellId = local.equippedSpells[activeSlot];
        if (spellId && local.isAlive) {
          const fwd = new THREE.Vector3();
          camera.getWorldDirection(fwd);
          cast = {
            spellId,
            slotIndex: activeSlot,
            aimDir: { x: fwd.x, y: fwd.y, z: fwd.z },
          };
        }
      }
      lastCastRef.current = lmbDown;

      // Mobility: edge-trigger only on Shift press, not hold
      const mobilityFired = movement.mobility && !wasShiftRef.current;
      wasShiftRef.current = movement.mobility;

      // Apply mobility cooldown locally for immediate UI feedback
      if (mobilityFired && local.isAlive && local.class) {
        const mSpellId = MOBILITY_SPELL[local.class];
        const mSpell = mSpellId ? getSpell(mSpellId) : null;
        if (mSpell && !(local.cooldowns[mSpellId] > 0)) {
          useGameStore.getState().setLocalCooldown(mSpellId, mSpell.cooldown * 1000);
        }
      }

      const seq = prediction.nextSeq();
      ws.send(C2S.PLAYER_INPUT, {
        seq,
        ts: ws.serverNow,
        flags,
        yaw: yawRef.current,
        pitch: pitchRef.current,
        cast,
        mobility: mobilityFired,
      });

      prediction.store({
        seq,
        ts: ws.serverNow,
        flags,
        yaw: yawRef.current,
        pitch: pitchRef.current,
        cast,
        mobility: movement.mobility,
        predictedPosition: { ...posRef.current },
      });
    }
  });

  return null;
}
