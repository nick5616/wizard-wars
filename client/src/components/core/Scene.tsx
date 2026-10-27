/**
 * Three.js scene root. Connects all 3D components.
 */

import { Suspense, useCallback, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { Arena } from './Arena';
import { CameraController } from './CameraController';
import { RemotePlayer } from './RemotePlayer';
import { LocalPlayerModel } from './LocalPlayerModel';
import { SpellRenderer } from '../spells/SpellRenderer';
import { DamageNumbers } from '../spells/DamageNumbers';
import { AoeTargetReticle } from '../spells/AoeTargetReticle';
import { SniperSightLines } from '../spells/SniperSightLines';
import { TremorSense } from './TremorSense';
import { useGameStore } from '../../stores/gameStore';
import { useNetworkStore } from '../../stores/networkStore';
import { useRenderGate } from '../../stores/renderGate';
import { useQualityStore, QUALITY_PRESETS } from '../../stores/qualityStore';
import { LightPool } from './LightPool';
import { ShaderWarmup } from './ShaderWarmup';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import type { ClientPrediction } from '../../networking/ClientPrediction';
import type { EntityInterpolation } from '../../networking/EntityInterpolation';

interface SceneProps {
  ws: WebSocketClient;
  prediction: ClientPrediction;
  interpolation: EntityInterpolation;
}

// Menu phases that cover the whole viewport with an opaque panel (they carry
// their own backdrop canvas, if any). Rendering the arena behind them is pure
// waste -- a full lit/shadowed frame at 60Hz that nobody can see -- so the
// main loop is parked and resumes the instant a match phase begins.
const OPAQUE_MENU_PHASES = new Set(['connecting', 'main_menu', 'mode_select', 'duel_select', 'class_select']);

export function Scene({ ws, prediction, interpolation }: SceneProps) {
  const players = useGameStore((s) => s.players);
  const thirdPerson = useGameStore((s) => s.thirdPerson);
  const covered = useRenderGate((s) => s.covers > 0);
  const sceneVisible = useGameStore((s) => !OPAQUE_MENU_PHASES.has(s.phase)) && !covered;
  const tier = useQualityStore((s) => s.tier);
  const preset = QUALITY_PRESETS[tier];
  const { localPlayerId } = useNetworkStore();

  // Stable identity so the memoised RemotePlayer isn't re-rendered by a new closure each pass.
  const serverNow = useCallback(() => ws.serverNow, [ws]);

  const remotePlayers = useMemo(
    () => Object.values(players).filter(p => p.id !== localPlayerId),
    [players, localPlayerId],
  );

  return (
    <Canvas
      style={{ width: '100vw', height: '100vh', background: '#050508' }}
      camera={{ fov: 80, near: 0.05, far: 400 }}
      // MSAA is fixed at context creation (the tier at first mount decides);
      // 'high-performance' asks hybrid-GPU laptops for the discrete GPU.
      gl={{ antialias: preset.antialias, powerPreference: 'high-performance', toneMapping: 3 /* ACESFilmicToneMapping */ }}
      // Cap the backing-store scale: a 2-3x hi-dpi display otherwise renders
      // 4-9x the pixels for a lit+shadowed scene. The monitor below lowers it
      // further (via the tier) when frames run long.
      dpr={[1, preset.dpr]}
      shadows={preset.shadows}
      frameloop={sceneVisible ? 'always' : 'never'}
      onCreated={(state) => {
        // Dev-only handle for perf tooling (renderer.info, frame stats).
        if (import.meta.env.DEV) (window as unknown as { __r3f?: unknown }).__r3f = state;
      }}
    >
      <PerformanceMonitor
        flipflops={3}
        onDecline={() => useQualityStore.getState().stepDown()}
        onIncline={() => useQualityStore.getState().stepUp()}
        // Sustained misses only: a lone hitch must not drop the whole tier.
        onFallback={() => useQualityStore.getState().stepDown()}
      />
      <LightPool />
      <Suspense fallback={null}>
        <ShaderWarmup />
        <CameraController ws={ws} prediction={prediction} interpolation={interpolation} />
        <Arena quality={tier} />
        <SpellRenderer />
        <DamageNumbers />
        <TremorSense />
        <AoeTargetReticle />
        <SniperSightLines />
        {thirdPerson && <LocalPlayerModel />}

        {remotePlayers.map(player => (
          <RemotePlayer
            key={player.id}
            playerId={player.id}
            interpolation={interpolation}
            serverNow={serverNow}
            initialState={player}
          />
        ))}
      </Suspense>
    </Canvas>
  );
}
