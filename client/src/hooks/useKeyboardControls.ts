import { useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../stores/gameStore';
import { MAX_SPELL_SLOTS } from 'shared/spells';

export interface MovementState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jumping: boolean;
  mobility: boolean; // Shift = class mobility spell
  melee: boolean; // F = melee punch
}

export interface ActionState {
  castSlot: number | null;  // 1-9,0 = cast spell in that slot
  openSkillTree: boolean;
  slot: number; // 0-9 currently selected
}

const KEY_MAP: Record<string, keyof MovementState> = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'backward', ArrowDown: 'backward',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jumping',
  ShiftLeft: 'mobility', ShiftRight: 'mobility',
  KeyF: 'melee',
};

// Digit1-Digit9 select slots 0-8, Digit0 selects the 10th slot (index 9) —
// mirrors the "1234567890" top-row layout, capped at MAX_SPELL_SLOTS.
const DIGIT_TO_SLOT: Record<string, number> = {
  Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4,
  Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9,
};

export function useKeyboardControls() {
  const [movement, setMovement] = useState<MovementState>({
    forward: false, backward: false, left: false, right: false,
    jumping: false, mobility: false, melee: false,
  });

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't hijack keystrokes meant for a text field (e.g. the name input
    // on the class-select screen) -- WASD/F/Space would otherwise be eaten
    // by preventDefault before they ever reach the input's value.
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    const key = KEY_MAP[e.code];
    if (key) {
      e.preventDefault();
      setMovement(prev => prev[key] ? prev : { ...prev, [key]: true });
    }

    // Slot selection
    if (!useGameStore.getState().menuOpen) {
      const slot = DIGIT_TO_SLOT[e.code];
      if (slot !== undefined && slot < MAX_SPELL_SLOTS) useGameStore.getState().setActiveSlot(slot);
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
