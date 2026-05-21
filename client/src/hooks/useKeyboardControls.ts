import { useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../stores/gameStore';

export interface MovementState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jumping: boolean;
  mobility: boolean; // Shift = class mobility spell
}

export interface ActionState {
  castSlot: number | null;  // 1-4 = cast spell in that slot
  openSkillTree: boolean;
  slot: number; // 0-3 currently selected
}

const KEY_MAP: Record<string, keyof MovementState> = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'backward', ArrowDown: 'backward',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jumping',
  ShiftLeft: 'mobility', ShiftRight: 'mobility',
};

export function useKeyboardControls() {
  const [movement, setMovement] = useState<MovementState>({
    forward: false, backward: false, left: false, right: false,
    jumping: false, mobility: false,
  });

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const key = KEY_MAP[e.code];
    if (key) {
      e.preventDefault();
      setMovement(prev => prev[key] ? prev : { ...prev, [key]: true });
    }

    // Slot selection
    if (!useGameStore.getState().menuOpen) {
      if (e.code === 'Digit1') useGameStore.getState().setActiveSlot(0);
      if (e.code === 'Digit2') useGameStore.getState().setActiveSlot(1);
      if (e.code === 'Digit3') useGameStore.getState().setActiveSlot(2);
      if (e.code === 'Digit4') useGameStore.getState().setActiveSlot(3);
    }
  }, []);

  const onKeyUp = useCallback((e: KeyboardEvent) => {
    const key = KEY_MAP[e.code];
    if (key) setMovement(prev => prev[key] ? { ...prev, [key]: false } : prev);
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [onKeyDown, onKeyUp]);

  return { movement };
}
