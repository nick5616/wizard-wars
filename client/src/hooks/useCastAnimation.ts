import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../stores/gameStore';
import { getSpell } from 'shared/spells';
import type { IconKind } from '../components/ui/SpellTypeIcon';

export interface CastAnim { kind: IconKind; startedAt: number; }

/**
 * Watches for newly-appeared projectiles/effects owned by `playerId` and
 * flags a brief "cast" window (kind + start time) whenever one shows up, so
 * the arm/wand model (see PlayerModel.tsx) can play a matching animation.
 *
 * Every projectile/effect already carries the real spellId, and getSpell(id)
 * gives back that spell's true `type` — melee_swing/beam/aoe/amaterasu
 * effects and every projectile resolve correctly with no special-casing.
 * Gap: spells with no visible effect at all (Shatter, Petrify, Death Note,
 * Parry) and the per-class mobility dash don't broadcast anything an
 * observer can key off of, so they don't trigger an animation here.
 *
 * Read imperatively via useGameStore.getState() every frame rather than a
 * reactive subscription -- this runs once per rendered player per frame, and
 * projectiles/effects churn constantly, so subscribing would re-render every
 * player's whole model on every tick.
 */
export function useCastAnimation(playerId: string | null | undefined) {
  const castAnimRef = useRef<CastAnim | null>(null);
  const prevIds = useRef<Set<string>>(new Set());

  useFrame(() => {
    if (!playerId) return;
    const { projectiles, effects } = useGameStore.getState();
    const currentIds = new Set<string>();

    for (const [id, p] of Object.entries(projectiles)) {
      if (p.ownerId !== playerId) continue;
      const key = `p:${id}`;
      currentIds.add(key);
      if (!prevIds.current.has(key)) {
        castAnimRef.current = { kind: getSpell(p.spellId)?.type ?? 'projectile', startedAt: Date.now() };
      }
    }
    for (const [id, e] of Object.entries(effects)) {
      if (e.ownerId !== playerId) continue;
      const key = `e:${id}`;
      currentIds.add(key);
      if (!prevIds.current.has(key)) {
        const kind = getSpell(e.spellId)?.type;
        if (kind) castAnimRef.current = { kind, startedAt: Date.now() };
      }
    }
    prevIds.current = currentIds;
  });

  return castAnimRef;
}
