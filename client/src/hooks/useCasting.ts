import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { useGameStore } from '../stores/gameStore';
import { getSpell, MOBILITY_SPELL } from 'shared/spells';
import type { WebSocketClient } from '../networking/WebSocketClient';
import type { ClientPrediction } from '../networking/ClientPrediction';
import type { CastInput } from '../types/game.types';

interface CastingOptions {
  ws: WebSocketClient;
  prediction: ClientPrediction;
  cameraRef: React.RefObject<THREE.Camera>;
}

export function useCasting({ ws, prediction, cameraRef }: CastingOptions) {
  const lmbWasDown = useRef(false);

  const tryCast = useCallback((lmbDown: boolean): { seq: number; castInput: CastInput; ts: number } | null => {
    const { local, setLocalCooldown } = useGameStore.getState();
    if (!local.isAlive || !local.class) return null;

    // Edge-trigger on LMB press
    if (!lmbDown || lmbWasDown.current) {
      lmbWasDown.current = lmbDown;
      return null;
    }
    lmbWasDown.current = true;

    const spellId = local.equippedSpells[local.activeSlot];
    if (!spellId) return null;

    const spell = getSpell(spellId);
    if (!spell) return null;

    const cd = local.cooldowns[spellId] ?? 0;
    if (cd > 0) return null;

    const camera = cameraRef.current;
    if (!camera) return null;

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const aimDir = { x: dir.x, y: dir.y, z: dir.z };

    const seq = prediction.nextSeq();
    const ts = ws.serverNow;

    const castInput: CastInput = {
      spellId,
      slotIndex: local.activeSlot,
      aimDir,
    };

    setLocalCooldown(spellId, spell.cooldown * 1000);

    return { seq, castInput, ts };
  }, [ws, prediction, cameraRef]);

  const tryMobility = useCallback((): boolean => {
    const { local, setLocalCooldown } = useGameStore.getState();
    if (!local.isAlive || !local.class) return false;

    const mobilitySpellId = (MOBILITY_SPELL as Record<string, string>)[local.class];
    if (!mobilitySpellId) return false;

    const cd = local.cooldowns[mobilitySpellId] ?? 0;
    if (cd > 0) return false;

    const spell = getSpell(mobilitySpellId);
    if (spell) setLocalCooldown(mobilitySpellId, spell.cooldown * 1000);

    return true;
  }, []);

  return { tryCast, tryMobility };
}
