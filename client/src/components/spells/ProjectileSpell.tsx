import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getSpell } from 'shared/spells';
import { PROJECTILE_GRAVITY } from 'shared/gameConfig';
import type { ProjectileState, SpellDef } from '../../types/game.types';
import { createBladeGeometry } from '../../utils/bladeGeometry';

interface ProjectileSpellProps {
  projectile: ProjectileState;
}

export function ProjectileSpell({ projectile }: ProjectileSpellProps) {
  const coreRef    = useRef<THREE.Mesh>(null);
  const bladeRef   = useRef<THREE.Mesh>(null);
  const glowRef    = useRef<THREE.Mesh>(null);
  const trailRef   = useRef<THREE.Mesh>(null);
  const light1Ref  = useRef<THREE.PointLight>(null);
  const light2Ref  = useRef<THREE.PointLight>(null);
  const posRef     = useRef({ ...projectile.position });
  const velRef     = useRef({ ...projectile.velocity });
  const timeRef    = useRef(0);

  // getSpell comes from untyped shared JS, so name the type here -- without
  // it `spell.gravity` is `any` and can't index PROJECTILE_GRAVITY.
  const spell      = getSpell(projectile.spellId) as SpellDef | null;
  const color      = spell?.color     ?? '#ffffff';
  const glowColor  = spell?.glowColor ?? '#ffffff';
  const coreRadius = Math.max(Math.min(projectile.radius * 0.45, 0.45), 0.12);

  // 'arc' spells (Fireball, ...) fall under gravity -- see SpellSystem.tickProjectiles
  // for the server-authoritative version this mirrors between snapshots.
  const isArcType  = spell?.type === 'arc';
  const gravity    = PROJECTILE_GRAVITY[spell?.gravity ?? 'normal'] ?? PROJECTILE_GRAVITY.normal;

  // Sword projectiles (Bladestorm, Siege Blade, ...) fly as a solid faceted
  // blade shard instead of the generic glowing orb every other class uses --
  // see bladeGeometry.ts for the shape. Steel, not energy: no self-glow, no
  // tumble, no magic trail -- it just holds its heading and catches the
  // scene's actual lights as it moves, the way a real blade would.
  const isBlade = spell?.class === 'sword' && (spell.type === 'projectile' || spell.type === 'arc');
  const bladeGeometry = useMemo(
    () => (isBlade ? createBladeGeometry(coreRadius * 3.2, coreRadius * 2.4, coreRadius * 0.85) : null),
    [isBlade, coreRadius],
  );

  // Multi-projectile spread casts (Bladestorm, Dirt Clod, ...) spawn several
  // of these at once -- 2 point lights apiece was the single biggest lag
  // spike in the game (see ProjectileSpell perf notes). A single projectile
  // still gets its full dynamic lighting; a spread just relies on its own
  // bright emissive core + glow shell instead, which reads as "physical
  // debris catching the light" rather than "each shard is its own lamp".
  // Blades never self-light at all, regardless of spread -- shine comes from
  // the scene's real lights, not from being a lamp themselves.
  const ownsLight = !isBlade && (!spell?.spreadCount || spell.spreadCount <= 1);

  // Velocity-derived trail geometry — recomputed only when velocity changes,
  // which for straight-line spells only happens at server-snapshot rate. For
  // 'arc' spells gravity means the direction shifts every frame instead, so
  // those recompute it live in useFrame below and write it straight onto the
  // meshes rather than relying on this memo.
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

  // Snap to authoritative server position/velocity on each server tick
  useMemo(() => {
    posRef.current = { ...projectile.position };
    velRef.current = { ...projectile.velocity };
  }, [projectile.position.x, projectile.position.y, projectile.position.z]);

  const liveDirScratch = useRef(new THREE.Vector3());
  const liveQuatScratch = useRef(new THREE.Quaternion());

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    timeRef.current += dt;

    if (isArcType) velRef.current.y += gravity * dt;
    posRef.current.x += velRef.current.x * dt;
    posRef.current.y += velRef.current.y * dt;
    posRef.current.z += velRef.current.z * dt;
    const { x, y, z } = posRef.current;

    // For a flat trajectory, the direction only changes at snapshot rate, so
    // the memoized values above are enough. For an arc, recompute every
    // frame from the live gravity-integrated velocity so the trail visibly
    // bends through the lob instead of freezing at the launch angle.
    let curDir = velDir, curLen = trailLen, curQuat = trailQuat;
    if (isArcType) {
      const v = velRef.current;
      const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      curLen = Math.min(speed * 0.1, 2.4);
      curDir = speed > 0.1
        ? liveDirScratch.current.set(v.x / speed, v.y / speed, v.z / speed)
        : liveDirScratch.current.set(0, 0, -1);
      curQuat = liveQuatScratch.current.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curDir);
    }

    const pulse = 1 + Math.sin(timeRef.current * 18) * 0.09;

    if (coreRef.current) {
      coreRef.current.position.set(x, y, z);
      coreRef.current.scale.setScalar(pulse);
    }
    if (bladeRef.current) {
      bladeRef.current.position.set(x, y, z);
      // Holds its heading (velocity-aligned) with no extra spin -- a stable
      // blade catches a specular highlight as it moves; a tumbling one just
      // looks like flickering noise.
      bladeRef.current.quaternion.copy(curQuat);
    }
    if (glowRef.current) {
      glowRef.current.position.set(x, y, z);
      glowRef.current.scale.setScalar(pulse * 0.85 + 0.15);
    }
    if (trailRef.current) {
      const offset = curLen * 0.5;
      trailRef.current.position.set(
        x - curDir.x * offset,
        y - curDir.y * offset,
        z - curDir.z * offset,
      );
      if (isArcType) trailRef.current.quaternion.copy(curQuat);
    }
    if (ownsLight) {
      if (light1Ref.current) light1Ref.current.position.set(x, y, z);
      if (light2Ref.current) light2Ref.current.position.set(x, y, z);
    }
  });

  const ip: [number, number, number] = [
    projectile.position.x,
    projectile.position.y,
    projectile.position.z,
  ];

  return (
    <>
      {isBlade && bladeGeometry ? (
        // Solid faceted steel -- no emissive, no glow shell, no magic trail.
        // Just a shape that reflects whatever light is actually in the scene.
        <mesh ref={bladeRef} position={ip} geometry={bladeGeometry}>
          <meshPhysicalMaterial
            color={color}
            flatShading
            roughness={0.08}
            metalness={0.9}
            clearcoat={1}
            clearcoatRoughness={0.04}
            ior={2.2}
            reflectivity={1}
          />
        </mesh>
      ) : (
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
        </>
      )}

      {/* Tight bright light that illuminates nearby surfaces -- skipped for
          spread casts and blades, see `ownsLight` above */}
      {ownsLight && (
        <>
          <pointLight ref={light1Ref} position={ip} color={glowColor} intensity={18} distance={12} decay={2} />
          {/* Wide soft ambient glow */}
          <pointLight ref={light2Ref} position={ip} color={glowColor} intensity={6}  distance={24} decay={2} />
        </>
      )}
    </>
  );
}
