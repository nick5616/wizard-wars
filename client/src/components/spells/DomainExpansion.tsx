/**
 * Domain expansion screen-space and environmental effects.
 * Each domain has a unique visual treatment.
 */

import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { DomainState } from '../../types/game.types';

interface DomainExpansionProps {
  domain: DomainState;
}

const DOMAIN_CONFIG: Record<string, { fogColor: string; fogDensity: number; ambientColor: string; particleColor: string }> = {
  inferno_domain:  { fogColor: '#ff2200', fogDensity: 0.04, ambientColor: '#ff4400', particleColor: '#ff6600' },
  absolute_zero:   { fogColor: '#88bbff', fogDensity: 0.05, ambientColor: '#aaccff', particleColor: '#ffffff' },
  event_horizon:   { fogColor: '#110022', fogDensity: 0.06, ambientColor: '#330055', particleColor: '#8800ff' },
  the_last_word:   { fogColor: '#222222', fogDensity: 0.02, ambientColor: '#666666', particleColor: '#ffffff' },
  terra_domain:    { fogColor: '#331100', fogDensity: 0.05, ambientColor: '#553300', particleColor: '#886622' },
};

export function DomainExpansion({ domain }: DomainExpansionProps) {
  const { scene } = useThree();
  const config = DOMAIN_CONFIG[domain.spellId];
  if (!config) return null;

  const prevFog = useRef<THREE.Fog | THREE.FogExp2 | null>(null);
  const prevAmbient = useRef<string>('#334466');

  useEffect(() => {
    prevFog.current = scene.fog;
    scene.fog = new THREE.FogExp2(config.fogColor, config.fogDensity);
    return () => {
      scene.fog = prevFog.current;
    };
  }, [scene, config]);

  return <TelegraphRing domain={domain} color={config.particleColor} />;
}

function TelegraphRing({ domain, color }: { domain: DomainState; color: string }) {
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!ringRef.current) return;
    const now = Date.now();
    const telegraphProgress = Math.min(1, (now - domain.startedAt) / (domain.activatesAt - domain.startedAt));
    const active = now >= domain.activatesAt;

    if (active) {
      const lifeProgress = (now - domain.activatesAt) / (domain.expiresAt - domain.activatesAt);
      ringRef.current.scale.setScalar(1 + lifeProgress * 0.2);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = 0.3;
    } else {
      ringRef.current.scale.setScalar(telegraphProgress * 1.2);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = telegraphProgress * 0.8;
    }
  });

  return (
    <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
      <ringGeometry args={[28, 30, 64]} />
      <meshBasicMaterial color={color} transparent opacity={0.5} />
    </mesh>
  );
}
