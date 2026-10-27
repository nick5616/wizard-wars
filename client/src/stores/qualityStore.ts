/**
 * Graphics quality: a user-facing setting ('auto' | 'low' | 'medium' | 'high')
 * plus the *effective* tier the renderer actually runs at.
 *
 * In 'auto' the Scene's PerformanceMonitor steps `tier` down when frames run
 * long and back up when there's headroom (see Scene.tsx); picking an explicit
 * level pins it. Everything render-side reads the knobs from QUALITY_PRESETS
 * via `useQualityStore((s) => s.tier)` (reactive) or `getQuality()` (inside
 * useFrame / non-React code), so one place decides what each tier costs:
 *
 *   dpr         -- upper bound handed to <Canvas dpr={[1, dpr]}>; the biggest
 *                  single fill-rate lever on hi-dpi displays
 *   maxLights   -- size of the pooled point-light set (components/core/LightPool).
 *                  The scene's light COUNT never changes mid-match, which is what
 *                  keeps three.js from recompiling every lit material's shader
 *                  each time a projectile spawns
 *   shadows     -- whether the Canvas renders shadow maps at all
 *   antialias   -- MSAA on the main canvas (only read at context creation)
 *
 * Other systems (e.g. the Arena) can read `getQuality()` / `useQualityStore`
 * to scale their own cost; the store has no dependency on the renderer.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type QualityTier = 'low' | 'medium' | 'high';
export type QualitySetting = QualityTier | 'auto';

export interface QualityPreset {
  dpr: number;
  maxLights: number;
  shadows: boolean;
  antialias: boolean;
}

export const QUALITY_PRESETS: Record<QualityTier, QualityPreset> = {
  low:    { dpr: 1,    maxLights: 3,  shadows: false, antialias: false },
  medium: { dpr: 1.25, maxLights: 6,  shadows: true,  antialias: true },
  high:   { dpr: 1.75, maxLights: 10, shadows: true,  antialias: true },
};

const TIER_ORDER: QualityTier[] = ['low', 'medium', 'high'];

interface QualityState {
  setting: QualitySetting;
  /** Effective tier. Equals `setting` unless the setting is 'auto'. */
  tier: QualityTier;
  setSetting: (s: QualitySetting) => void;
  /** Auto mode only: move one step down/up. No-ops at the ends or when pinned. */
  stepDown: () => void;
  stepUp: () => void;
}

/** Phones/tablets start a tier lower; auto-mode climbs from there if it can. */
function initialAutoTier(): QualityTier {
  if (typeof navigator === 'undefined') return 'high';
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
  return mobile ? 'low' : weak ? 'medium' : 'high';
}

export const useQualityStore = create<QualityState>()(
  persist(
    (set, get) => ({
      setting: 'auto',
      tier: initialAutoTier(),
      setSetting: (setting) => set({ setting, tier: setting === 'auto' ? initialAutoTier() : setting }),
      stepDown: () => {
        const { setting, tier } = get();
        if (setting !== 'auto') return;
        const i = TIER_ORDER.indexOf(tier);
        if (i > 0) set({ tier: TIER_ORDER[i - 1] });
      },
      stepUp: () => {
        const { setting, tier } = get();
        if (setting !== 'auto') return;
        const i = TIER_ORDER.indexOf(tier);
        if (i < TIER_ORDER.length - 1) set({ tier: TIER_ORDER[i + 1] });
      },
    }),
    {
      name: 'wizardwars_quality_settings',
      // Only the user's choice persists; an auto tier is re-derived per session.
      partialize: (s) => ({ setting: s.setting }),
      merge: (persisted, current) => {
        const setting = (persisted as { setting?: QualitySetting } | undefined)?.setting ?? current.setting;
        return { ...current, setting, tier: setting === 'auto' ? current.tier : setting };
      },
    },
  ),
);

/** Non-reactive read of the current preset, for useFrame and other non-React code. */
export function getQuality(): QualityPreset {
  return QUALITY_PRESETS[useQualityStore.getState().tier];
}
