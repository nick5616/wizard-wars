/**
 * Three.js scene root. Connects all 3D components.
 */

import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Arena } from './Arena';
import { CameraController } from './CameraController';
import { RemotePlayer } from './RemotePlayer';
import { SpellRenderer } from '../spells/SpellRenderer';
import { DamageNumbers } from '../spells/DamageNumbers';
import { useGameStore } from '../../stores/gameStore';
import { useNetworkStore } from '../../stores/networkStore';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import type { ClientPrediction } from '../../networking/ClientPrediction';
import type { EntityInterpolation } from '../../networking/EntityInterpolation';

interface SceneProps {
  ws: WebSocketClient;
  prediction: ClientPrediction;
  interpolation: EntityInterpolation;
}

export function Scene({ ws, prediction, interpolation }: SceneProps) {
  const players = useGameStore((s) => s.players);
  const { localPlayerId } = useNetworkStore();

  const remotePlayers = useMemo(
    () => Object.values(players).filter(p => p.id !== localPlayerId),
    [players, localPlayerId],
  );

  return (
    <Canvas
      style={{ width: '100vw', height: '100vh', background: '#050508' }}
      camera={{ fov: 80, near: 0.05, far: 400 }}
      gl={{ antialias: true, toneMapping: 3 /* ACESFilmicToneMapping */ }}
      shadows
    >
      <Suspense fallback={null}>
        <CameraController ws={ws} prediction={prediction} />
        <Arena />
        <SpellRenderer />
        <DamageNumbers />

        {remotePlayers.map(player => (
          <RemotePlayer
            key={player.id}
            playerId={player.id}
            interpolation={interpolation}
            serverNow={() => ws.serverNow}
            initialState={player}
          />
        ))}
      </Suspense>
    </Canvas>
  );
}
