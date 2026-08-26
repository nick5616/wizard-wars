/**
 * The local player's own body, visible only in third person (see
 * CameraController's Mouse3 toggle) -- first person never renders it, same
 * as most FPS games. Driven imperatively off the local prediction position
 * (gameStore) and localOrientation (yaw), not React props, so this doesn't
 * re-render every frame the way a reactive subscription would.
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../stores/gameStore';
import { useNetworkStore } from '../../stores/networkStore';
import { localOrientation } from '../../networking/localOrientation';
import { PLAYER_HEIGHT } from 'shared/constants';
import { hatScaleForLevel } from 'shared/leveling';
import { ArmAndWand } from './ArmAndWand';
import { SwordBuffShards } from './SwordBuffShards';
import { useCastAnimation } from '../../hooks/useCastAnimation';
import { getSpell, DEFENSIVE_SPELL } from 'shared/spells';
import { hatColorFor } from '../../utils/teamColor';

const HAT_CONE_RADIUS = 0.28;
const HAT_CONE_HEIGHT = 0.5;
const HAT_BASE_LOCAL_Y = 1.95;

const CLASS_COLORS: Record<string, string> = {
  fire: '#ff4500', ice: '#a0d8ff', dark: '#6600cc', sword: '#c8c8c8', druid: '#5a9e3d', crystalmancer: '#8fd4ff', default: '#888888',
};

export function LocalPlayerModel() {
  const groupRef = useRef<THREE.Group>(null);
  const { localPlayerId } = useNetworkStore.getState();
  const castAnimRef = useCastAnimation(localPlayerId);

  useFrame(() => {
    const { local } = useGameStore.getState();
    if (!groupRef.current) return;
    if (!local.isAlive) { groupRef.current.visible = false; return; }
    groupRef.current.visible = true;
    groupRef.current.position.set(local.position.x, local.position.y - PLAYER_HEIGHT, local.position.z);
    groupRef.current.rotation.y = localOrientation.yaw;
  });

  const local = useGameStore.getState().local;
  const color = CLASS_COLORS[local.class ?? 'default'] ?? CLASS_COLORS.default;
  const hatScale = hatScaleForLevel(local.level ?? 1);

  // Team color on the hat only -- the body stays class-colored so an
  // opponent's class is still readable at a glance. See utils/teamColor.ts.
  const players = useGameStore((s) => s.players);
  const hatColor = hatColorFor(local.team, color, players);

  // Unlike the rest of this component, the wand gem needs to be reactive --
  // it only changes on the rare occasions the active slot/loadout changes,
  // so a normal store subscription here doesn't fight the "driven
  // imperatively for position" design (position/rotation still bypass React).
  const activeSpellId = useGameStore((s) => s.local.equippedSpells[s.local.activeSlot] ?? null);
  const gemColor = (activeSpellId ? getSpell(activeSpellId)?.color : null) ?? color;

  // Defensive spell (Q) visual cue: one plain translucent shell, no light --
  // exactly the "single entity, no light" shape lag-heavy multi-entity spell
  // effects should have followed all along (see ProjectileSpell.tsx).
  const defensiveActive = useGameStore((s) => s.local.defensiveActive);
  const defensiveSpellId = local.class ? DEFENSIVE_SPELL[local.class] : null;
  const defensiveGlow = defensiveSpellId ? getSpell(defensiveSpellId)?.glowColor : null;

  // Parry / Phantom Blade have no visual of their own server-side (pure
  // state flags) -- reflect them here instead of adding a whole new
  // world-space effect system just for two spells.
  const parryActive = useGameStore((s) => s.local.parryActive);
  const phantomCasts = useGameStore((s) => s.local.phantomCasts);

  return (
    <group ref={groupRef}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <capsuleGeometry args={[0.35, 1.0, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.1} />
      </mesh>

      <mesh position={[0, 1.75, 0]} castShadow>
        <sphereGeometry args={[0.3, 8, 8]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.2} />
      </mesh>

      <group position={[0, HAT_BASE_LOCAL_Y, 0]} scale={[hatScale, hatScale, hatScale]}>
        <mesh position={[0, HAT_CONE_HEIGHT / 2, 0]} castShadow>
          <coneGeometry args={[HAT_CONE_RADIUS, HAT_CONE_HEIGHT, 12]} />
          <meshStandardMaterial color={hatColor} roughness={0.45} metalness={0.2} />
        </mesh>
      </group>

      <pointLight position={[0, 1.5, 0]} intensity={0.5} distance={3} color={color} />

      {defensiveActive && defensiveGlow && (
        <mesh position={[0, 1.0, 0]}>
          <sphereGeometry args={[1.05, 16, 12]} />
          <meshBasicMaterial color={defensiveGlow} transparent opacity={0.22} depthWrite={false} />
        </mesh>
      )}

      {local.class === 'sword' && (
        <SwordBuffShards color={color} parryActive={parryActive} phantomCasts={phantomCasts} />
      )}

      <ArmAndWand color={color} gemColor={gemColor} castAnimRef={castAnimRef} />
    </group>
  );
}
