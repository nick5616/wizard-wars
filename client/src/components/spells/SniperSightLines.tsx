/**
 * Faint, persistent aim line for endgame hitscan spells (spell.sniperSight —
 * God Ray, Divine Judgement, Null Gaze, God's Edge, The Monolith) while one
 * is the selected hotbar slot and off cooldown. Driven off each player's
 * broadcast activeSlot/yaw/pitch (see Player.js/Room.processInput), not just
 * the local player's own aim, so a target downrange can actually see the
 * line pointed at them before the shot ever fires — the same tension as a
 * sniper's laser sight, not a private crosshair aid.
 */

import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../stores/gameStore';
import { getSpell } from 'shared/spells';
import { wandTipWorldPosition } from '../../utils/wandTip';
import type { PlayerState } from '../../types/game.types';

const RANGE = 80;

function aimDirFromYawPitch(yaw: number, pitch: number) {
  return {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
}

export function SniperSightLines() {
  const players = useGameStore((s) => s.players);

  const qualifying = Object.values(players).filter((p) => {
    if (!p.isAlive) return false;
    const spellId = p.equippedSpells[p.activeSlot ?? 0];
    if (!spellId) return false;
    const spell = getSpell(spellId);
    if (!spell?.sniperSight) return false;
    if ((p.cooldowns[spellId] ?? 0) > 0) return false;
    return true;
  });

  return (
    <>
      {qualifying.map((p) => <SniperLine key={p.id} player={p} />)}
    </>
  );
}

function SniperLine({ player }: { player: PlayerState }) {
  const scene = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const mat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.14, depthWrite: false });
    return { geo, mat, line: new THREE.Line(geo, mat) };
  }, []);

  useEffect(() => () => {
    scene.geo.dispose();
    scene.mat.dispose();
  }, [scene]);

  useFrame(() => {
    const dir = aimDirFromYawPitch(player.yaw, player.pitch);
    const origin = wandTipWorldPosition(player.position, player.yaw);
    const positions = new Float32Array([
      origin.x, origin.y, origin.z,
      origin.x + dir.x * RANGE, origin.y + dir.y * RANGE, origin.z + dir.z * RANGE,
    ]);
    scene.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    scene.geo.attributes.position.needsUpdate = true;
    // Subtle shimmer so it reads as a live threat rather than a static decal.
    scene.mat.opacity = 0.1 + Math.abs(Math.sin(Date.now() / 500)) * 0.08;
  });

  return <primitive object={scene.line} />;
}
