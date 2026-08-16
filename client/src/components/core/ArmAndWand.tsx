/**
 * A single procedural arm+wand (shoulder rig simplified to one rigid
 * forearm+wand assembly, not a full joint chain) attached at shoulder
 * height. Its pose is driven purely by time-since-cast-started and the
 * spell-type "kind" of whatever was just cast (see useCastAnimation) --
 * each kind gets a visibly distinct motion, auto-returning to a relaxed
 * rest pose once its short animation window elapses.
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { CastAnim } from '../../hooks/useCastAnimation';

const REST_PITCH = 0.35;

/** [pitch, yaw, forwardPush] local rotation/offset for the arm group, by cast kind + elapsed time. */
function computePose(cast: CastAnim | null, now: number): [number, number, number] {
  if (!cast) return [REST_PITCH, 0, 0];
  const t = (now - cast.startedAt) / 1000;

  switch (cast.kind) {
    case 'melee': {
      const dur = 0.25;
      if (t > dur) return [REST_PITCH, 0, 0];
      const swing = Math.sin((t / dur) * Math.PI);
      return [REST_PITCH - swing * 1.15, (t / dur < 0.5 ? -1 : 1) * swing * 0.55, swing * 0.22];
    }
    case 'hitscan':
    case 'direct': {
      const dur = 0.18;
      if (t > dur) return [REST_PITCH, 0, 0];
      const snap = Math.sin((t / dur) * Math.PI);
      return [REST_PITCH - snap * 0.55, 0, snap * 0.28];
    }
    case 'projectile': {
      const dur = 0.22;
      if (t > dur) return [REST_PITCH, 0, 0];
      const p = t / dur;
      const pull = p < 0.35 ? -(p / 0.35) : ((p - 0.35) / 0.65);
      return [REST_PITCH - Math.max(-0.3, pull) * 0.7, 0, Math.max(0, pull) * 0.35];
    }
    case 'beam': {
      const rampDur = 0.15;
      const held = Math.min(1, t / rampDur);
      return [REST_PITCH - held * 0.55, Math.sin(t * 3) * 0.05, held * 0.2];
    }
    case 'aoe': {
      const dur = 0.4;
      if (t > dur) return [REST_PITCH, 0, 0];
      const p = t / dur;
      const raise = p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6;
      return [REST_PITCH - raise * 1.5, 0, raise * 0.2];
    }
    case 'domain': {
      const dur = 0.9;
      if (t > dur) return [REST_PITCH, 0, 0];
      const p = Math.min(1, t / dur);
      return [REST_PITCH - p * 1.8, Math.sin(t * 4) * 0.15, 0];
    }
    case 'mobility': {
      const dur = 0.25;
      if (t > dur) return [REST_PITCH, 0, 0];
      const sweep = Math.sin((t / dur) * Math.PI);
      return [REST_PITCH, sweep * 1.1, 0];
    }
    default:
      return [REST_PITCH, 0, 0];
  }
}

export function ArmAndWand({ color, castAnimRef }: { color: string; castAnimRef: React.RefObject<CastAnim | null> }) {
  const rigRef = useRef<THREE.Group>(null);
  const gemRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!rigRef.current) return;
    const now = Date.now();
    const cast = castAnimRef.current;
    // Auto-expire finished animations so computePose keeps returning rest pose
    // without needing an external clear.
    const [pitch, yaw, push] = computePose(cast, now);
    rigRef.current.rotation.x = pitch;
    rigRef.current.rotation.y = yaw;
    rigRef.current.position.z = -(0.15 + push);

    if (gemRef.current) {
      const active = cast && (now - cast.startedAt) < 900;
      const target = active ? 2.4 : 0.5;
      const mat = gemRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity += (target - mat.emissiveIntensity) * 0.25;
    }
  });

  return (
    <group position={[0.3, 1.3, 0]}>
      <group ref={rigRef} rotation={[REST_PITCH, 0, 0]}>
        {/* upper arm stub — local -Z is forward (this game's yaw convention: forward = (-sin(yaw), -cos(yaw)), i.e. -Z at yaw 0), not +Z */}
        <mesh position={[0, 0, -0.15]} rotation={[-Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.07, 0.08, 0.3, 6]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
        {/* wand shaft */}
        <mesh position={[0, 0, -0.55]} rotation={[-Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.02, 0.035, 0.55, 6]} />
          <meshStandardMaterial color="#2a1a10" roughness={0.5} />
        </mesh>
        {/* tip gem — brightens while casting */}
        <mesh ref={gemRef} position={[0, 0, -0.86]}>
          <sphereGeometry args={[0.055, 8, 8]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
        </mesh>
      </group>
    </group>
  );
}
