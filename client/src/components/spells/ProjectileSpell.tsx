import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getSpell } from 'shared/spells';
import type { ProjectileState } from '../../types/game.types';

interface ProjectileSpellProps {
  projectile: ProjectileState;
}

export function ProjectileSpell({ projectile }: ProjectileSpellProps) {
  const coreRef    = useRef<THREE.Mesh>(null);
  const glowRef    = useRef<THREE.Mesh>(null);
  const trailRef   = useRef<THREE.Mesh>(null);
  const light1Ref  = useRef<THREE.PointLight>(null);
  const light2Ref  = useRef<THREE.PointLight>(null);
  const posRef     = useRef({ ...projectile.position });
  const timeRef    = useRef(0);

  const spell      = getSpell(projectile.spellId);
  const color      = spell?.color     ?? '#ffffff';
  const glowColor  = spell?.glowColor ?? '#ffffff';
  const coreRadius = Math.max(Math.min(projectile.radius * 0.45, 0.45), 0.12);

  // Velocity-derived trail geometry — recomputed only when velocity changes
  const { velDir, trailLen, trailQuat } = useMemo(() => {
    const v = projectile.velocity;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    const len   = Math.min(speed * 0.1, 2.4);
    const dir   = speed > 0.1
      ? new THREE.Vector3(v.x / speed, v.y / speed, v.z / speed)
      : new THREE.Vector3(0, 0, -1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    return { velDir: dir, trailLen: len, trailQuat: q };
  }, [projectile.velocity.x, projectile.velocity.y, projectile.velocity.z]);

  // Snap to authoritative server position on tick
  useMemo(() => {
    posRef.current = { ...projectile.position };
  }, [projectile.position.x, projectile.position.y, projectile.position.z]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    timeRef.current += dt;

    posRef.current.x += projectile.velocity.x * dt;
    posRef.current.y += projectile.velocity.y * dt;
    posRef.current.z += projectile.velocity.z * dt;
    const { x, y, z } = posRef.current;

    const pulse = 1 + Math.sin(timeRef.current * 18) * 0.09;

    if (coreRef.current) {
      coreRef.current.position.set(x, y, z);
      coreRef.current.scale.setScalar(pulse);
    }
    if (glowRef.current) {
      glowRef.current.position.set(x, y, z);
      glowRef.current.scale.setScalar(pulse * 0.85 + 0.15);
    }
    if (trailRef.current) {
      const offset = trailLen * 0.5;
      trailRef.current.position.set(
        x - velDir.x * offset,
        y - velDir.y * offset,
        z - velDir.z * offset,
      );
    }
    if (light1Ref.current) light1Ref.current.position.set(x, y, z);
    if (light2Ref.current) light2Ref.current.position.set(x, y, z);
  });

  const ip: [number, number, number] = [
    projectile.position.x,
    projectile.position.y,
    projectile.position.z,
  ];

  return (
    <>
      {/* Solid bright core — meshBasicMaterial so it's always full-bright */}
      <mesh ref={coreRef} position={ip}>
        <sphereGeometry args={[coreRadius, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>

      {/* Large translucent glow shell */}
      <mesh ref={glowRef} position={ip}>
        <sphereGeometry args={[coreRadius * 3.5, 10, 10]} />
        <meshBasicMaterial color={glowColor} transparent opacity={0.15} side={THREE.BackSide} />
      </mesh>

      {/* Velocity-oriented streak trailing behind the projectile */}
      {trailLen > 0.15 && (
        <mesh
          ref={trailRef}
          position={[
            ip[0] - velDir.x * trailLen * 0.5,
            ip[1] - velDir.y * trailLen * 0.5,
            ip[2] - velDir.z * trailLen * 0.5,
          ]}
          quaternion={trailQuat}
        >
          <cylinderGeometry args={[coreRadius * 0.55, coreRadius * 0.04, trailLen, 6]} />
          <meshBasicMaterial color={glowColor} transparent opacity={0.38} />
        </mesh>
      )}

      {/* Tight bright light that illuminates nearby surfaces */}
      <pointLight ref={light1Ref} position={ip} color={glowColor} intensity={18} distance={12} decay={2} />
      {/* Wide soft ambient glow */}
      <pointLight ref={light2Ref} position={ip} color={glowColor} intensity={6}  distance={24} decay={2} />
    </>
  );
}
