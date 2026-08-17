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
import { useCastAnimation } from '../../hooks/useCastAnimation';
import { getSpell } from 'shared/spells';

const HAT_CONE_RADIUS = 0.28;
const HAT_CONE_HEIGHT = 0.5;
const HAT_BASE_LOCAL_Y = 1.95;

const CLASS_COLORS: Record<string, string> = {
  fire: '#ff4500', ice: '#a0d8ff', dark: '#6600cc', sword: '#c8c8c8', earth: '#8B6914', default: '#888888',
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

  // Unlike the rest of this component, the wand gem needs to be reactive --
  // it only changes on the rare occasions the active slot/loadout changes,
  // so a normal store subscription here doesn't fight the "driven
  // imperatively for position" design (position/rotation still bypass React).
  const activeSpellId = useGameStore((s) => s.local.equippedSpells[s.local.activeSlot] ?? null);
  const gemColor = (activeSpellId ? getSpell(activeSpellId)?.color : null) ?? color;

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
          <meshStandardMaterial color={color} roughness={0.45} metalness={0.2} />
        </mesh>
      </group>

      <pointLight position={[0, 1.5, 0]} intensity={0.5} distance={3} color={color} />

      <ArmAndWand color={color} gemColor={gemColor} castAnimRef={castAnimRef} />
    </group>
  );
}
