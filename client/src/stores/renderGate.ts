/**
 * Whether something opaque covers the whole viewport on top of the main 3D
 * canvas (the pause menu today). While true the Scene parks its render loop:
 * drawing a lit, shadowed arena that is completely hidden behind an opaque
 * panel is pure cost -- and the pause menu runs its own second WebGL canvas
 * (BattleScene) on top of it. Counted, so overlapping covers nest safely.
 */

import { create } from 'zustand';

interface RenderGateState {
  covers: number;
  cover: () => () => void;
}

export const useRenderGate = create<RenderGateState>((set) => ({
  covers: 0,
  /** Register a full-screen opaque cover; returns the function that removes it. */
  cover: () => {
    set((s) => ({ covers: s.covers + 1 }));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set((s) => ({ covers: Math.max(0, s.covers - 1) }));
    };
  },
}));
