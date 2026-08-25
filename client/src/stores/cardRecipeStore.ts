/**
 * Owns which recipe each spell card draws with.
 *
 * Resolution order for a given spell:
 *   1. an explicit assignment (picked in the Design Lab, persisted to
 *      data/cardRecipeBank.json), else
 *   2. a deterministic fallback generated from the spell's own id, school and
 *      tier.
 *
 * Step 2 is the important one: it means every spell in the game already
 * reads at the right power level without anyone assigning anything, because
 * grade is derived from tier normalised *within the spell's own class*. A
 * class capstone lands at grade 1.0 and gets the full mythic treatment; a
 * tier-1 starter lands at 0 and stays deliberately plain. Assignments are
 * then just hand-overrides where the generated look isn't quite right.
 *
 * Edits made in the Design Lab go to localStorage immediately (so the hotbar
 * updates live while you tune) and are written back to the JSON file through
 * the server on "Save to repo" -- see C2S.SAVE_CARD_RECIPES.
 */

import { create } from 'zustand';
import { ALL_SPELLS } from 'shared/spells';
import type { CardRecipe, CardRecipeBank, BankEntry } from '../data/cardRecipe';
import { fallbackRecipe } from '../utils/cardRecipeGen';
import bankFile from '../data/cardRecipeBank.json';
import type { SpellDef } from '../types/game.types';

const LS_KEY = 'ww.cardRecipeBank.v1';

/**
 * Highest tier within each class, so grade normalises per class. Fire topping
 * out at tier 8 and earth at tier 6 should both mean "this is the best thing
 * my class has", not "fire cards are shinier than earth cards".
 */
const MAX_TIER_BY_CLASS: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const spell of Object.values(ALL_SPELLS) as SpellDef[]) {
    if (!spell.class) continue;
    out[spell.class] = Math.max(out[spell.class] ?? 1, spell.tier ?? 1);
  }
  return out;
})();

function loadPersisted(): CardRecipeBank {
  const base = bankFile as CardRecipeBank;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { bank: { ...base.bank }, assignments: { ...base.assignments } };
    const saved = JSON.parse(raw) as Partial<CardRecipeBank>;
    return {
      bank: { ...base.bank, ...(saved.bank ?? {}) },
      assignments: { ...base.assignments, ...(saved.assignments ?? {}) },
    };
  } catch {
    return { bank: { ...base.bank }, assignments: { ...base.assignments } };
  }
}

function persist(state: CardRecipeBank) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ bank: state.bank, assignments: state.assignments }));
  } catch {
    // Private-mode / quota. The in-memory state is still correct for this
    // session, and "Save to repo" is the durable path anyway.
  }
}

interface CardRecipeState extends CardRecipeBank {
  /** Add (or replace) a recipe in the bank without assigning it to anything. */
  saveToBank: (recipe: CardRecipe, note?: string) => void;
  removeFromBank: (recipeId: string) => void;
  /** Bank the recipe if needed, then point a spell at it. */
  assign: (spellId: string, recipe: CardRecipe) => void;
  unassign: (spellId: string) => void;
  /** Drop every local edit and fall back to what's committed in the JSON file. */
  resetLocal: () => void;
  /** Replace wholesale -- used after a successful save round-trip. */
  hydrate: (next: CardRecipeBank) => void;
}

export const useCardRecipeStore = create<CardRecipeState>((set, get) => ({
  ...loadPersisted(),

  saveToBank: (recipe, note) => {
    const bank: Record<string, BankEntry> = {
      ...get().bank,
      [recipe.id]: { ...get().bank[recipe.id], recipe, note },
    };
    set({ bank });
    persist({ bank, assignments: get().assignments });
  },

  removeFromBank: (recipeId) => {
    const bank = { ...get().bank };
    delete bank[recipeId];
    // Any spell pointing at it falls back to its generated look.
    const assignments = Object.fromEntries(
      Object.entries(get().assignments).filter(([, id]) => id !== recipeId),
    );
    set({ bank, assignments });
    persist({ bank, assignments });
  },

  assign: (spellId, recipe) => {
    const prev = get();
    const bank: Record<string, BankEntry> = { ...prev.bank };
    const existing = bank[recipe.id];
    const assignedTo = new Set(existing?.assigned ?? []);
    assignedTo.add(spellId);
    bank[recipe.id] = { ...existing, recipe, assigned: [...assignedTo] };

    // A spell can only point at one recipe, so drop it from whatever it was
    // on before -- otherwise `assigned` lists drift out of sync with reality.
    const previousId = prev.assignments[spellId];
    if (previousId && previousId !== recipe.id && bank[previousId]) {
      bank[previousId] = {
        ...bank[previousId],
        assigned: (bank[previousId].assigned ?? []).filter((s) => s !== spellId),
      };
    }

    const assignments = { ...prev.assignments, [spellId]: recipe.id };
    set({ bank, assignments });
    persist({ bank, assignments });
  },

  unassign: (spellId) => {
    const prev = get();
    const assignments = { ...prev.assignments };
    const recipeId = assignments[spellId];
    delete assignments[spellId];

    const bank = { ...prev.bank };
    if (recipeId && bank[recipeId]) {
      bank[recipeId] = {
        ...bank[recipeId],
        assigned: (bank[recipeId].assigned ?? []).filter((s) => s !== spellId),
      };
    }
    set({ bank, assignments });
    persist({ bank, assignments });
  },

  resetLocal: () => {
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    const base = bankFile as CardRecipeBank;
    set({ bank: { ...base.bank }, assignments: { ...base.assignments } });
  },

  hydrate: (next) => {
    set({ bank: next.bank, assignments: next.assignments });
    persist(next);
  },
}));

// ─── Resolution ────────────────────────────────────────────────────────────

const fallbackCache = new Map<string, CardRecipe>();

/** The generated look for a spell, memoised -- this is pure and hit on every card render. */
export function recipeFor(spellId: string, school: string | undefined, wizardClass: string | undefined, tier: number): CardRecipe {
  const key = `${spellId}|${school}|${wizardClass}|${tier}`;
  const hit = fallbackCache.get(key);
  if (hit) return hit;
  const made = fallbackRecipe(spellId, school, tier, MAX_TIER_BY_CLASS[wizardClass ?? ''] ?? 8);
  fallbackCache.set(key, made);
  return made;
}

/** Non-reactive resolve, for code outside React. */
export function resolveRecipe(spellId: string | null, spell: SpellDef | null): CardRecipe | null {
  if (!spellId) return null;
  const { bank, assignments } = useCardRecipeStore.getState();
  const assigned = assignments[spellId];
  if (assigned && bank[assigned]) return bank[assigned].recipe;
  return recipeFor(spellId, spell?.school, spell?.class, spell?.tier ?? 1);
}

/** Reactive resolve for components -- re-renders when the Design Lab changes an assignment. */
export function useSpellRecipe(spellId: string | null, spell: SpellDef | null): CardRecipe | null {
  const assignedId = useCardRecipeStore((s) => (spellId ? s.assignments[spellId] : undefined));
  const entry = useCardRecipeStore((s) => (assignedId ? s.bank[assignedId] : undefined));
  if (!spellId) return null;
  if (entry) return entry.recipe;
  return recipeFor(spellId, spell?.school, spell?.class, spell?.tier ?? 1);
}

export { MAX_TIER_BY_CLASS };
