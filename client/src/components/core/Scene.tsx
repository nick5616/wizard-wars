/**
 * Three.js scene root. Connects all 3D components.
 */

import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { ACESFilmicToneMapping } from 'three';
import { WebGPURenderer } from 'three/webgpu';
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
      gl={async (props) => {
        // WebGPURenderer transparently falls back to a WebGL2 backend when
        // WebGPU isn't available in the browser.
        const renderer = new WebGPURenderer({
          canvas: props.canvas as HTMLCanvasElement,
          antialias: true,
        });
        renderer.toneMapping = ACESFilmicToneMapping;
        await renderer.init();
        // WebGPU configures its swapchain from the canvas's size at init time,
        // which is still the browser's 300x150 default (nothing has sized the
        // canvas yet). r3f resizes it a moment later, but the WebGPU backend's
        // own MSAA attachment doesn't get fully recreated by that later resize,
        // leaving a stale 300x150 attachment alongside a correctly-sized
        // swapchain -- WebGPU then rejects the mismatched render pass. Sizing
        // to the real viewport here avoids ever configuring at the wrong size.
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        return renderer;
      }}
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
