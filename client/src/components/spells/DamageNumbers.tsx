import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore, type DamageNumber } from '../../stores/gameStore';

const DURATION = 1.6; // seconds

export function DamageNumbers() {
  const damageNumbers = useGameStore((s) => s.damageNumbers);
  const { pruneDamageNumbers } = useGameStore.getState();

  useFrame(() => {
    pruneDamageNumbers();
  });

  return (
    <>
      {damageNumbers.map((n) => (
        <DamageNumberItem key={n.id} entry={n} />
      ))}
    </>
  );
}

function DamageNumberItem({ entry }: { entry: DamageNumber }) {
  const groupRef = useRef<THREE.Group>(null);
  const divRef = useRef<HTMLDivElement>(null);

  useFrame(() => {
    const age = (Date.now() - entry.spawnedAt) / 1000;
    if (age > DURATION) return;

    const t = age / DURATION; // 0→1

    // Float upward 2.5 units over lifetime
    if (groupRef.current) {
      groupRef.current.position.y = entry.y + 2.4 + t * 2.5;
    }

    if (divRef.current) {
      // Pop scale: overshoot on spawn then settle
      const scale = age < 0.12
        ? 1 + (age / 0.12) * 0.5           // 0 → 1.5× in first 120ms
        : age < 0.22
          ? 1.5 - ((age - 0.12) / 0.1) * 0.4  // 1.5 → 1.1× next 100ms
          : 1.1 - t * 0.1;                   // slow shrink rest of life

      // Fade out in final 40% of lifetime
      const opacity = t < 0.6 ? 1 : 1 - ((t - 0.6) / 0.4);

      divRef.current.style.opacity = String(Math.max(0, opacity));
      divRef.current.style.transform = `scale(${scale}) translate(-50%, -50%)`;
    }
  });

  return (
    <group ref={groupRef} position={[entry.x, entry.y + 2.4, entry.z]}>
      <Html
        center={false}
        style={{ pointerEvents: 'none', userSelect: 'none', overflow: 'visible' }}
        zIndexRange={[0, 0]}
      >
        <div
          ref={divRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: 'translate(-50%, -50%)',
            transformOrigin: 'center center',
            fontFamily: "'Courier New', monospace",
            fontWeight: 900,
            fontSize: entry.fontSize,
            color: entry.color,
            textShadow: `0 0 8px ${entry.color}, 0 2px 0 rgba(0,0,0,0.9), 0 0 20px ${entry.color}88`,
            whiteSpace: 'nowrap',
            letterSpacing: 1,
          }}
        >
          -{entry.value}
        </div>
      </Html>
    </group>
  );
}
