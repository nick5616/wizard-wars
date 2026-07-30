import { useMemo } from 'react';
import * as THREE from 'three';
import { useGameStore } from '../../stores/gameStore';
import { ARENA_RADIUS, ARENA_WALL_HEIGHT } from 'shared/constants';

const FLOOR_SEGMENTS = 128;
const WALL_SEGMENTS  = 128;

export function Arena() {
  const domains = useGameStore((s) => s.domains);

  const activeDomain = useMemo(() => {
    for (const d of Object.values(domains)) {
      if (d.active && Date.now() < d.expiresAt) return d;
    }
    return null;
  }, [domains]);

  const domainColor = useMemo(() => {
    if (!activeDomain) return null;
    const colorMap: Record<string, string> = {
      inferno_domain: '#ff4400',
      absolute_zero:  '#88ccff',
      event_horizon:  '#220044',
      the_last_word:  '#888888',
      terra_domain:   '#553300',
    };
    return colorMap[activeDomain.spellId] ?? null;
  }, [activeDomain]);

  const floorColor = domainColor ?? '#252545';

  return (
    <>
      {/* Ambient floor — prevents any surface from hitting pure black */}
      <ambientLight intensity={domainColor ? 0.4 : 0.6} color={domainColor ?? '#334466'} />

      {/* Hemisphere light: sky above, warm ground below — gives even readable fill */}
      <hemisphereLight
        args={[domainColor ?? '#8899cc', '#221133', domainColor ? 1.2 : 2.0]}
      />

      {/* Primary overhead directional — strong, casts shadows */}
      <directionalLight
        position={[0, 28, 0]}
        intensity={domainColor ? 1.5 : 3.5}
        color={domainColor ?? '#aabbdd'}
        castShadow
        shadow-camera-left={-ARENA_RADIUS - 4}
        shadow-camera-right={ARENA_RADIUS + 4}
        shadow-camera-top={ARENA_RADIUS + 4}
        shadow-camera-bottom={-ARENA_RADIUS - 4}
        shadow-camera-near={1}
        shadow-camera-far={60}
      />

      {/* Angled fill light to soften harsh top shadows */}
      <directionalLight
        position={[20, 10, 15]}
        intensity={domainColor ? 0.4 : 1.2}
        color={domainColor ?? '#8899cc'}
      />
      <directionalLight
        position={[-20, 10, -15]}
        intensity={domainColor ? 0.4 : 1.0}
        color={domainColor ?? '#7788bb'}
      />

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[ARENA_RADIUS, FLOOR_SEGMENTS]} />
        <meshStandardMaterial
          color={floorColor}
          roughness={0.85}
          metalness={0.15}
        />
      </mesh>

      {/* Orientation rings — give players clear spatial reference */}
      <FloorRing radius={ARENA_RADIUS * 0.25} color={domainColor ?? '#3a3a6a'} emissive={domainColor ?? '#2a2a55'} />
      <FloorRing radius={ARENA_RADIUS * 0.50} color={domainColor ?? '#3a3a6a'} emissive={domainColor ?? '#2a2a55'} />
      <FloorRing radius={ARENA_RADIUS * 0.72} color={domainColor ?? '#4444aa'} emissive={domainColor ?? '#3333aa'} />

      {/* Center marker */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[1.2, 32]} />
        <meshStandardMaterial color={domainColor ?? '#444488'} emissive={domainColor ?? '#3333aa'} emissiveIntensity={1.2} />
      </mesh>

      {/* Outer ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[ARENA_RADIUS - 0.8, ARENA_RADIUS - 0.4, WALL_SEGMENTS]} />
        <meshStandardMaterial color={domainColor ?? '#5555aa'} emissive={domainColor ?? '#3333aa'} emissiveIntensity={0.8} />
      </mesh>

      {/* Circular wall */}
      <mesh position={[0, ARENA_WALL_HEIGHT / 2, 0]}>
        <cylinderGeometry
          args={[ARENA_RADIUS, ARENA_RADIUS, ARENA_WALL_HEIGHT, WALL_SEGMENTS, 1, true]}
        />
        <meshStandardMaterial
          color="#181830"
          side={THREE.BackSide}
          roughness={1}
          metalness={0}
        />
      </mesh>

      <Pillars count={8} radius={ARENA_RADIUS - 1.5} domainColor={domainColor} />
    </>
  );
}

function FloorRing({ radius, color, emissive }: { radius: number; color: string; emissive: string }) {
  const thickness = 0.35;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <ringGeometry args={[radius - thickness / 2, radius + thickness / 2, 64]} />
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.9} />
    </mesh>
  );
}

function Pillars({ count, radius, domainColor }: { count: number; radius: number; domainColor: string | null }) {
  const positions = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      return { x: Math.sin(angle) * radius, z: Math.cos(angle) * radius };
    });
  }, [count, radius]);

  return (
    <>
      {positions.map((pos, i) => (
        <group key={i} position={[pos.x, 0, pos.z]}>
          {/* Stone pillar */}
          <mesh castShadow>
            <cylinderGeometry args={[0.4, 0.5, 5, 8]} />
            <meshStandardMaterial color="#252535" roughness={0.9} />
          </mesh>
          {/* Torch flame — brighter so they actually light the space */}
          <pointLight
            position={[0, 5.5, 0]}
            intensity={domainColor ? 3 : 4}
            distance={14}
            color={domainColor ?? '#ff8833'}
            decay={2}
          />
          {/* Flame emissive sphere */}
          <mesh position={[0, 5.2, 0]}>
            <sphereGeometry args={[0.18, 6, 6]} />
            <meshStandardMaterial
              emissive={domainColor ?? '#ff6600'}
              emissiveIntensity={5}
              color="#000"
            />
          </mesh>
        </group>
      ))}
    </>
  );
}
