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
import { buildMoveContext, type ClientPrediction, type PredState } from '../../networking/ClientPrediction';
import { netDebug } from '../../networking/netDebug';
import type { Vec3, CastInput } from '../../types/game.types';
import { INPUT_FLAGS } from 'shared/events';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import type { EntityInterpolation } from '../../networking/EntityInterpolation';
import { C2S } from 'shared/events';
import { PLAYER_HEIGHT, CAST_MAX_RANGE, ARENA_RADIUS, TICK_RATE, BASE_MOVE_SPEED, MOVE_CURVE_SPEED_CAP, MAX_CURVE_DEG } from 'shared/constants';
import { MOBILITY_SPELL, DEFENSIVE_SPELL, BASIC_ATTACK, MELEE_ATTACK, getSpell } from 'shared/spells';
import { getTargetObjects } from '../../networking/targetRegistry';
import { audioManager } from '../../audio/AudioManager';
import { localOrientation } from '../../networking/localOrientation';
import { terrainRaycastBlocked } from 'shared/mapLayout';

const MOUSE_SENSITIVITY = 0.002;

// Movement is integrated in fixed steps (matching the server's tick rate)
// instead of once per rendered frame with that frame's raw variable delta --
// requestAnimationFrame timing isn't perfectly even (GC pauses, compositor
// hitches, background-tab throttling), and feeding that unevenness straight
// into position integration is what made walking feel jittery/"icy" even
// with a healthy connection. Capped backlog so a stall (alt-tab, a long
// hitch) can't spiral into simulating a burst of catch-up steps at once.
const MOVE_STEP = 1 / TICK_RATE;
const MAX_MOVE_SUBSTEPS = 8;

// Reconciliation corrections are applied to the true predicted state at once
// (so the simulation never drifts), and the *rendered* camera is eased from
// where it was to there over this time constant by a decaying offset. A
// correction thus never shows as a snap, and tiny numerical corrections are
// invisible instead of needing a dead zone. Anything bigger than the snap
// distance (respawn, teleport, a big knockback) skips the easing.
const CORRECTION_SMOOTH_TAU = 0.09; // s
const CORRECTION_SNAP_DIST = 3;     // world units

/** Walk up from a raycast hit to find the registered player group and its tagged id. */
function resolvePlayerIdFromHit(obj: THREE.Object3D | null): string | undefined {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (cur.userData?.playerId) return cur.userData.playerId as string;
    cur = cur.parent;
  }
  return undefined;
}

interface Props {
  ws: WebSocketClient;
  prediction: ClientPrediction;
  /** Optional: lets each input report the server time remotes are being drawn at (lag-comp rewind target, see SpellSystem._lagCompTime). */
  interpolation?: EntityInterpolation;
}

export function CameraController({ ws, prediction, interpolation }: Props) {
  const { camera } = useThree();
  const { movement } = useKeyboardControls();
  const { isLocked, consumeDelta, lmbRef, rmbRef, mmbRef } = useMouseControls();
  const wasMmbRef = useRef(false);
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const posRef = useRef({ x: 0, y: PLAYER_HEIGHT, z: 0 });
  const velRef = useRef({ x: 0, y: 0, z: 0 });
  const airJumpsUsedRef = useRef(0);
  const wasJumpDownRef = useRef(false);
  const pendingJumpEdgeRef = useRef(false); // sticky until the next throttled network send consumes it, so a fast press can't fall between two 64Hz sends and never reach the server
  const renderOffsetRef = useRef({ x: 0, y: 0, z: 0 }); // decaying visual offset from reconciliation, see CORRECTION_SMOOTH_TAU
  const moveAccumRef = useRef(0); // fixed-step movement integration backlog, see useFrame below
  const lastCastRef = useRef(false);
  const lastBasicAttackRef = useRef(false);
  const raycasterRef = useRef(new THREE.Raycaster());
  const wasAliveRef = useRef(false);
  const wasShiftRef = useRef(false);
  const wasQRef = useRef(false);
  const wasMeleeRef = useRef(false);

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
    const { local, setLocalPosition, setLocalMoveCurve, menuOpen } = useGameStore.getState();

    // While any menu is open: freeze all game input (no look, no move, no cast)
    if (menuOpen) return;

    // Experiment Lab: static overhead view of the whole arena -- decoupled
    // entirely from the local player's body/input, which just stays wherever
    // it was (godmode, so nothing depends on it moving) while this is on.
    if (useGameStore.getState().birdsEyeView) {
      camera.position.set(0, ARENA_RADIUS * 1.8, ARENA_RADIUS * 0.9);
      camera.lookAt(0, 0, 0);
      return;
    }

    // Middle mouse button: toggle third-person (edge-triggered on press)
    const mmbFired = mmbRef.current && !wasMmbRef.current;
    wasMmbRef.current = mmbRef.current;
    if (mmbFired) {
      const { thirdPerson, setThirdPerson } = useGameStore.getState();
      setThirdPerson(!thirdPerson);
    }

    const { localPlayerId } = useNetworkStore.getState();

    // On spawn/respawn: snap camera to the server-provided position so projectiles
    // originate from the right place instead of wherever the camera happened to be.
    if (local.isAlive && !wasAliveRef.current) {
      posRef.current = { ...local.position };
      velRef.current = { x: 0, y: 0, z: 0 };
      airJumpsUsedRef.current = 0;
      moveAccumRef.current = 0;
      renderOffsetRef.current = { x: 0, y: 0, z: 0 };
      prediction.reset();

      // Match spawns pick a facing (see Room.setupMatch/setupDuel) instead of
      // leaving the camera pointed wherever it last happened to look --
      // level the pitch out too so a fresh spawn always looks straight ahead.
      const { spawnYaw } = useGameStore.getState();
      if (spawnYaw != null) {
        yawRef.current = spawnYaw;
        pitchRef.current = 0;
        useGameStore.setState({ spawnYaw: null });
      }
    }
    wasAliveRef.current = local.isAlive;

    if (!local.isAlive) return;

    // Apply the newest server reconciliation (position + velocity + air
    // jumps, replayed over the unacked inputs). Position error becomes a
    // decaying visual offset instead of a blend of the simulation state.
    const correction: PredState | null = prediction.takeCorrection();
    if (correction) {
      const ex = posRef.current.x - correction.pos.x;
      const ey = posRef.current.y - correction.pos.y;
      const ez = posRef.current.z - correction.pos.z;
      const err = Math.sqrt(ex * ex + ey * ey + ez * ez);
      netDebug.onCorrection(err, prediction.unackedCount);
      if (err > CORRECTION_SNAP_DIST) {
        renderOffsetRef.current = { x: 0, y: 0, z: 0 };
      } else if (err > 0.0005) {
        const o = renderOffsetRef.current;
        o.x += ex; o.y += ey; o.z += ez;
      }
      posRef.current = correction.pos;
      velRef.current = correction.vel;
      airJumpsUsedRef.current = correction.airJumpsUsed;
    }

    // ── Mouse look ──────────────────────────────────────────────────────────
    if (netDebug.yawOverride !== null) {
      // Dev harness: scripted yaw (headless browsers have no pointer lock).
      yawRef.current = netDebug.yawOverride;
      euler.current.set(pitchRef.current, yawRef.current, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler.current);
    } else if (isLocked) {
      const d = consumeDelta();
      yawRef.current -= d.x * MOUSE_SENSITIVITY;
      pitchRef.current = Math.max(
        -Math.PI / 2 + 0.01,
        Math.min(Math.PI / 2 - 0.01, pitchRef.current - d.y * MOUSE_SENSITIVITY),
      );
      euler.current.set(pitchRef.current, yawRef.current, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler.current);
    }
    localOrientation.yaw = yawRef.current;
    localOrientation.pitch = pitchRef.current;

    // ── Client-side prediction ──────────────────────────────────────────────
    // Jump edge (rising edge of the key) gates the double jump separately
    // from the held-down JUMP bit, which drives ground auto-bhop -- see
    // shared/events.js INPUT_FLAGS.JUMP_EDGE. Detected every rendered frame
    // but stays pending until a predicted step actually ships it, so a press
    // between two 64Hz steps can't be silently dropped.
    if (movement.jumping && !wasJumpDownRef.current) pendingJumpEdgeRef.current = true;
    wasJumpDownRef.current = movement.jumping;

    let baseFlags = 0;
    if (movement.forward)  baseFlags |= INPUT_FLAGS.FORWARD;
    if (movement.backward) baseFlags |= INPUT_FLAGS.BACKWARD;
    if (movement.left)     baseFlags |= INPUT_FLAGS.LEFT;
    if (movement.right)    baseFlags |= INPUT_FLAGS.RIGHT;
    if (movement.jumping)  baseFlags |= INPUT_FLAGS.JUMP;
    if (movement.mobility) baseFlags |= INPUT_FLAGS.MOBILITY;

    const barrierCircles = Object.values(useGameStore.getState().barriers)
      .filter((b) => b.active)
      .map((b) => ({ x: b.position.x, z: b.position.z, radius: b.width / 2 }));

    // Status effects / domains / passives that scale this step's speed --
    // refreshed once per frame from the latest synced state (server clock).
    const nowServer = ws.serverNow;
    prediction.setMoveContext(buildMoveContext(localPlayerId ?? '', nowServer));

    // One input is generated per predicted MOVE_STEP (not per rendered frame
    // on a separate 64Hz accumulator, as it used to be). The server simulates
    // exactly one fixed step per input, so the two only stay in lockstep if
    // the client's step count and its sent-input count are the same number.
    // With the old pair of independent accumulators a 60fps client sent 60
    // inputs/s while predicting 64 steps/s: the server walked ~6% slower than
    // the prediction, a steady drift reconciliation had to fight every tick.
    moveAccumRef.current = Math.min(moveAccumRef.current + dt, MOVE_STEP * MAX_MOVE_SUBSTEPS);
    let result = { pos: posRef.current, vel: velRef.current, airJumpsUsed: airJumpsUsedRef.current };
    while (moveAccumRef.current >= MOVE_STEP) {
      moveAccumRef.current -= MOVE_STEP;

      const flags = baseFlags | (pendingJumpEdgeRef.current ? INPUT_FLAGS.JUMP_EDGE : 0);
      pendingJumpEdgeRef.current = false; // this step's flags already captured it

      // Aim direction, corrected for the eye/camera offset: the server's hit
      // detection (and every visual projectile/beam origin) is anchored at
      // the eye/wand, not the camera (see SpellSystem._castHitscan). In first
      // person eye and camera nearly coincide so this is just camera-forward;
      // in third person (camera pulled back and up for the Valheim-style
      // view) two parallel rays from different origins never meet, which is
      // exactly why shots were landing below the crosshair. Aiming from the
      // eye toward a point far out along the camera's own forward ray bends
      // the direction just enough that it actually lands on whatever's under
      // the crosshair.
      const eyePos = new THREE.Vector3(result.pos.x, result.pos.y, result.pos.z);
      const camFwd = new THREE.Vector3();
      camera.getWorldDirection(camFwd);
      const fwd = camera.position.clone().addScaledVector(camFwd, 200).sub(eyePos).normalize();

      const lmbDown = lmbRef.current;
      let cast: CastInput | null = null;

      // Cast on LMB press (edge trigger)
      if (lmbDown && !lastCastRef.current) {
        const spellId = local.equippedSpells[local.activeSlot];
        if (spellId && local.isAlive) {
          cast = {
            spellId,
            slotIndex: local.activeSlot,
            aimDir: { x: fwd.x, y: fwd.y, z: fwd.z },
          };

          // Direct-target spells (shatter, petrify, amaterasu, death_note) need a
          // targetId server-side -- raycast the crosshair against known remote players.
          const spellDef = getSpell(spellId);

          // Windup spells (Siege Blade, ...) resolve silently server-side --
          // no world effect exists until the windup elapses, which read as
          // "nothing happened" for up to a second. This is a pure client
          // prediction (no server round-trip) driving the crosshair charge
          // ring, sword-only for now -- see Crosshair.tsx.
          if (spellDef?.windupMs && spellDef.class === 'sword' && !(local.cooldowns[spellId] > 0)) {
            useGameStore.getState().setChargingSpell({ spellId, startedAt: Date.now(), windupMs: spellDef.windupMs });
          }

          if (spellDef?.requiresTarget) {
            // Ray from the actual eye position, not camera.position -- in
            // third-person the camera sits behind the player, and raycasting
            // from there would offset targeting (and could occlude on the
            // player's own third-person model). Uses the same corrected fwd
            // as above so target acquisition matches where shots actually go.
            raycasterRef.current.set(eyePos, fwd);
            raycasterRef.current.far = CAST_MAX_RANGE;
            const hits = raycasterRef.current.intersectObjects(getTargetObjects(), true);
            const targetId = hits.length > 0 ? resolvePlayerIdFromHit(hits[0].object) : undefined;
            if (targetId) cast.targetId = targetId;
          }
        }
      }
      lastCastRef.current = lmbDown;

      // Basic attack on RMB press (edge trigger) -- always available, no equip needed
      const debugMode = useGameStore.getState().debugMode;
      const rmbDown = rmbRef.current;
      let basicAttack: { aimDir: Vec3 } | null = null;
      if (rmbDown && !lastBasicAttackRef.current && local.class) {
        const spellId = BASIC_ATTACK[local.class];
        if (spellId && (debugMode || !(local.cooldowns[spellId] > 0))) {
          basicAttack = { aimDir: { x: fwd.x, y: fwd.y, z: fwd.z } };
          const spell = getSpell(spellId);
          // Debug mode: server never sets a cooldown for this spell, so don't
          // predict one locally either -- otherwise this optimistic guess
          // would briefly block repeat fire until the next server tick
          // corrects it back to 0.
          if (spell && !debugMode) useGameStore.getState().setLocalCooldown(spellId, spell.cooldown * 1000);
          audioManager.playSound('hitscan_fire');
        }
      }
      lastBasicAttackRef.current = rmbDown;

      // Melee on F press (edge trigger)
      const meleeFired = movement.melee && !wasMeleeRef.current;
      wasMeleeRef.current = movement.melee;
      let melee: { aimDir: Vec3 } | null = null;
      if (meleeFired && local.class) {
        const spellId = MELEE_ATTACK[local.class];
        if (spellId && (debugMode || !(local.cooldowns[spellId] > 0))) {
          melee = { aimDir: { x: fwd.x, y: fwd.y, z: fwd.z } };
          const spell = getSpell(spellId);
          if (spell && !debugMode) useGameStore.getState().setLocalCooldown(spellId, spell.cooldown * 1000);
          audioManager.playSound('melee_swing');
        }
      }

      // Mobility: edge-trigger only on Shift press, not hold. Predicted as
      // accepted when the server would accept it (off cooldown, not stunned);
      // the dash/launch then runs inside the predicted step like the server's.
      const mobilityFired = movement.mobility && !wasShiftRef.current;
      wasShiftRef.current = movement.mobility;
      let mobilityApplied = false;

      // Apply mobility cooldown locally for immediate UI feedback
      if (mobilityFired && local.isAlive && local.class) {
        const mSpellId = MOBILITY_SPELL[local.class];
        const mSpell = mSpellId ? getSpell(mSpellId) : null;
        if (mSpell && (debugMode || !(local.cooldowns[mSpellId] > 0))) {
          mobilityApplied = !prediction.moveContext.stunned;
          if (!debugMode) useGameStore.getState().setLocalCooldown(mSpellId, mSpell.cooldown * 1000);
        }
      }

      // Defensive spell: edge-trigger only on Q press, not hold -- same treatment as mobility
      const defensiveFired = movement.defensive && !wasQRef.current;
      wasQRef.current = movement.defensive;

      if (defensiveFired && local.isAlive && local.class) {
        const dSpellId = DEFENSIVE_SPELL[local.class];
        const dSpell = dSpellId ? getSpell(dSpellId) : null;
        if (dSpell && !debugMode && !(local.cooldowns[dSpellId] > 0)) {
          useGameStore.getState().setLocalCooldown(dSpellId, dSpell.cooldown * 1000);
        }
      }

      result = prediction.predict(result.pos, result.vel, flags, yawRef.current, MOVE_STEP, barrierCircles, result.airJumpsUsed, mobilityApplied);

      const seq = prediction.nextSeq();
      ws.send(C2S.PLAYER_INPUT, {
        seq,
        ts: nowServer,
        viewTs: interpolation ? Math.round(interpolation.renderTime()) : undefined,
        flags,
        yaw: yawRef.current,
        pitch: pitchRef.current,
        cast,
        mobility: mobilityFired,
        defensive: defensiveFired,
        basicAttack,
        melee,
        activeSlot: local.activeSlot,
      });

      prediction.store({
        seq,
        ts: nowServer,
        flags,
        yaw: yawRef.current,
        pitch: pitchRef.current,
        cast,
        mobility: mobilityFired,
        predictedPosition: { ...result.pos },
        vel: { ...result.vel },
        airJumpsUsed: result.airJumpsUsed,
        mobilityApplied,
      });
    }
    posRef.current = result.pos;
    velRef.current = result.vel;
    airJumpsUsedRef.current = result.airJumpsUsed;

    // Visual position = true predicted position + the decaying leftover of
    // recent reconciliation corrections (see above).
    const off = renderOffsetRef.current;
    const decay = Math.exp(-dt / CORRECTION_SMOOTH_TAU);
    off.x *= decay; off.y *= decay; off.z *= decay;
    const vis = { x: result.pos.x + off.x, y: result.pos.y + off.y, z: result.pos.z + off.z };

    if (useGameStore.getState().thirdPerson) {
      // Valheim-style chase cam: pulled well back and up above the character
      // instead of hovering right behind their head -- the old 4.2/0.5
      // numbers put the camera close enough that your own body filled the
      // screen and the crosshair sat directly on top of you. Orientation
      // still exactly matches the mouse-look quaternion (no lookAt), so
      // aiming stays crosshair-accurate -- only the vantage point moves.
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const desiredDist = 7.5, heightUp = 2.4;

      // Don't let the pulled-back camera clip through a wall behind the player.
      const behind = { x: -fwd.x, y: -fwd.y, z: -fwd.z };
      const blockDist = terrainRaycastBlocked(vis, behind, desiredDist);
      const dist = blockDist !== null ? Math.max(1.5, blockDist - 0.5) : desiredDist;

      camera.position.set(
        vis.x - fwd.x * dist,
        vis.y + heightUp - fwd.y * dist,
        vis.z - fwd.z * dist,
      );
    } else {
      camera.position.set(vis.x, vis.y + 0.1, vis.z);
    }
    setLocalPosition(result.pos);
    if (netDebug.enabled) {
      netDebug.local.x = result.pos.x; netDebug.local.y = result.pos.y; netDebug.local.z = result.pos.z;
      netDebug.local.vx = result.vel.x; netDebug.local.vy = result.vel.y; netDebug.local.vz = result.vel.z;
    }

    // Live preview of the movement-curve tech (see SpellSystem._castProjectile
    // server-side) so players can feel/learn how their current strafe would
    // bend a shot before they even cast -- same yaw basis, same formula. The
    // forward/backpedal ratio rides along for AoeTargetReticle's arc-landing
    // preview, which needs it to reproduce the server's launch-angle pick.
    {
      const yaw = yawRef.current;
      const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
      const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
      const lateralSpeed = result.vel.x * rightX + result.vel.z * rightZ;
      const forwardSpeed = result.vel.x * fwdX + result.vel.z * fwdZ;
      const lateralRatio = Math.max(-MOVE_CURVE_SPEED_CAP, Math.min(MOVE_CURVE_SPEED_CAP, lateralSpeed / BASE_MOVE_SPEED));
      const forwardRatio = Math.max(-MOVE_CURVE_SPEED_CAP, Math.min(MOVE_CURVE_SPEED_CAP, forwardSpeed / BASE_MOVE_SPEED));
      setLocalMoveCurve((lateralRatio / MOVE_CURVE_SPEED_CAP) * MAX_CURVE_DEG, forwardRatio);
    }
  });

  return null;
}
