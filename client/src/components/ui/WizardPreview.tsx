/**
 * Standalone mini 3D preview of the local player's wizard, used in the pause
 * menu. Gets its own <Canvas> (the only other one lives in Scene.tsx for the
 * main game world) since it needs to render while the game canvas keeps
 * running behind the fullscreen menu, on a fixed camera instead of the
 * player's live position/orientation.
 *
 * Geometry is a deliberate duplicate of RemotePlayer.tsx/LocalPlayerModel.tsx
 * (capsule body, sphere head, cone hat, ArmAndWand rig) rather than a shared
 * component -- those two are driven imperatively off network/prediction state
 * every frame, this one just wants static props and a slow idle spin.
 *
 * Cosmetic hook: gemColor already ties to whichever spell sits in the
 * selected hotbar slot (same convention as ArmAndWand elsewhere). This is
 * the intended spot to grow real per-spell cosmetics later -- e.g. swapping
 * hat/robe materials based on the equipped loadout.
 */

import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ArmAndWand } from '../core/ArmAndWand';
import { hatScaleForLevel } from 'shared/leveling';
import type { CastAnim } from '../../hooks/useCastAnimation';

const HAT_CONE_RADIUS = 0.28;
const HAT_CONE_HEIGHT = 0.5;
const HAT_BASE_LOCAL_Y = 1.95;

interface WizardPreviewProps {
  color: string;
  level: number;
  gemColor: string;
}

function PreviewModel({ color, level, gemColor }: WizardPreviewProps) {
  const groupRef = useRef<THREE.Group>(null);
  const castAnimRef = useRef<CastAnim | null>(null);
  const hatScale = hatScaleForLevel(level);

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.35;
  });

  return (
    <group ref={groupRef}>
      {/* Ground disc for grounding + a bit of class-colored ambience */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.62, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.1} />
      </mesh>

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

      <pointLight position={[0, 1.5, 0.6]} intensity={0.6} distance={4} color={color} />

      <ArmAndWand color={color} gemColor={gemColor} castAnimRef={castAnimRef} />
    </group>
  );
}

export function WizardPreview({ color, level, gemColor }: WizardPreviewProps) {
  return (
    <Canvas
      camera={{ fov: 38, position: [1.75, 1.5, 2.5] }}
      gl={{ antialias: true }}
      style={{ width: '100%', height: '100%' }}
      onCreated={({ camera }) => camera.lookAt(0, 1.05, 0)}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[3, 5, 2]} intensity={0.7} />
        <PreviewModel color={color} level={level} gemColor={gemColor} />
      </Suspense>
    </Canvas>
  );
}
