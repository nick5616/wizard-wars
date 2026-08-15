import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EntityInterpolation } from '../../networking/EntityInterpolation';
import type { PlayerState } from '../../types/game.types';
import { PLAYER_HEIGHT } from 'shared/constants';
import { hatScaleForLevel } from 'shared/leveling';
import { registerTarget, unregisterTarget } from '../../networking/targetRegistry';

// Must mirror the private HAT_CONE_* / HAT_BASE_LOCAL_Y constants in
// shared/leveling.js so the rendered hat lines up with where the server
// thinks the hat hitbox is for the contact-buff check.
const HAT_CONE_RADIUS = 0.28;
const HAT_CONE_HEIGHT = 0.5;
const HAT_BASE_LOCAL_Y = 1.95;

/** Multiplies a hex color's RGB channels toward black — used to visually mute bots. */
function darken(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 0xff) * factor);
  const g = Math.round(((n >> 8) & 0xff) * factor);
  const b = Math.round((n & 0xff) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const CLASS_COLORS: Record<string, string> = {
  fire: '#ff4500',
  ice: '#a0d8ff',
  dark: '#6600cc',
  sword: '#c8c8c8',
  earth: '#8B6914',
  default: '#888888',
};

interface RemotePlayerProps {
  playerId: string;
  interpolation: EntityInterpolation;
  serverNow: () => number;
  initialState: PlayerState;
}

export function RemotePlayer({ playerId, interpolation, serverNow, initialState }: RemotePlayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const healthBarRef = useRef<THREE.Mesh>(null);

  const baseColor = CLASS_COLORS[initialState.class ?? 'default'] ?? CLASS_COLORS.default;
  const color = initialState.isBot ? darken(baseColor, 0.55) : baseColor;
  const hatScale = hatScaleForLevel(initialState.level ?? 1);

  useEffect(() => {
    if (groupRef.current) registerTarget(playerId, groupRef.current);
    return () => unregisterTarget(playerId);
  }, [playerId]);

  useFrame(() => {
    const interp = interpolation.getInterpolated(playerId, serverNow());
    if (!interp || !groupRef.current) return;

    if (!interp.isAlive) {
      groupRef.current.visible = false;
      return;
    }
    groupRef.current.visible = true;

    // interp.position.y is the camera/eye level (PLAYER_HEIGHT above the floor).
    // Subtract PLAYER_HEIGHT so the model's feet rest on the floor.
    groupRef.current.position.set(interp.position.x, interp.position.y - PLAYER_HEIGHT, interp.position.z);
    groupRef.current.rotation.y = interp.yaw;

    // Health bar scale
    if (healthBarRef.current) {
      const hp = Math.max(0, Math.min(1, interp.health / initialState.maxHealth));
      healthBarRef.current.scale.x = hp;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Body capsule */}
      <mesh position={[0, 0.9, 0]} castShadow>
        <capsuleGeometry args={[0.35, 1.0, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.1} />
      </mesh>

      {/* Head */}
      <mesh position={[0, 1.75, 0]} castShadow>
        <sphereGeometry args={[0.3, 8, 8]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.2} />
      </mesh>

      {/* Wizard hat -- grows with level, see shared/leveling.js:hatScaleForLevel */}
      <group position={[0, HAT_BASE_LOCAL_Y, 0]} scale={[hatScale, hatScale, hatScale]}>
        <mesh position={[0, HAT_CONE_HEIGHT / 2, 0]} castShadow>
          <coneGeometry args={[HAT_CONE_RADIUS, HAT_CONE_HEIGHT, 12]} />
          <meshStandardMaterial color={color} roughness={0.45} metalness={0.2} />
        </mesh>
      </group>

      {/* Class glow */}
      <pointLight position={[0, 1.5, 0]} intensity={0.5} distance={3} color={color} />

      {/* Bot marker: a small dark ring at the feet — desaturated color alone reads as "off" at a distance, this makes it explicit */}
      {initialState.isBot && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.4, 0.5, 16]} />
          <meshBasicMaterial color="#333333" transparent opacity={0.8} depthTest={false} />
        </mesh>
      )}

      {/* Health bar background */}
      <mesh position={[0, 2.4, 0]} rotation={[0, 0, 0]}>
        <planeGeometry args={[0.8, 0.08]} />
        <meshBasicMaterial color="#222222" depthTest={false} />
      </mesh>

      {/* Health bar fill */}
      <mesh
        ref={healthBarRef}
        position={[-0.4 + 0.4, 2.4, 0.001]}
        rotation={[0, 0, 0]}
        scale={[1, 1, 1]}
      >
        <planeGeometry args={[0.8, 0.06]} />
        <meshBasicMaterial color="#44ff44" depthTest={false} />
      </mesh>
    </group>
  );
}
