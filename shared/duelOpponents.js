/**
 * Curated 1v1 duel opponents for the Single Player "1v1" mode (see
 * client/src/components/ui/DuelSelect.tsx, Room.setupDuel). Each has a
 * fixed ELO-style rating standing in for how hard they're predicted to be
 * relative to a fresh player's starting 1000 rating (see Player.js's `elo`
 * and Room._maybeEndMatch's duel branch) -- picking a higher-rated
 * opponent stakes more reputation on the win and costs less on a loss;
 * picking a lower-rated one is the reverse.
 *
 * `spellCount` slices that many spells (by tier, ascending) off
 * shared/spells.js's equippableSpellsForClass(class) to build the bot's
 * loadout -- difficulty comes from both `behavior` and how many options
 * the bot actually has, not just aim/reaction tuning.
 */
export const DUEL_OPPONENTS = [
  { id: 'ember_novice',     name: 'Ember Novice',     class: 'fire',          behavior: 'docile',     spellCount: 2, elo: 800 },
  { id: 'blaze_adept',      name: 'Blaze Adept',      class: 'fire',          behavior: 'aggressive', spellCount: 4, elo: 1100 },
  { id: 'inferno_veteran',  name: 'Inferno Veteran',  class: 'fire',          behavior: 'aggressive', spellCount: 7, elo: 1450 },

  { id: 'frost_novice',     name: 'Frost Novice',     class: 'ice',           behavior: 'docile',     spellCount: 2, elo: 800 },
  { id: 'glacier_adept',    name: 'Glacier Adept',    class: 'ice',           behavior: 'aggressive', spellCount: 4, elo: 1100 },
  { id: 'absolute_veteran', name: 'Absolute Veteran', class: 'ice',           behavior: 'aggressive', spellCount: 7, elo: 1450 },

  { id: 'void_novice',      name: 'Void Novice',      class: 'dark',         behavior: 'docile',     spellCount: 2, elo: 800 },
  { id: 'hollow_adept',     name: 'Hollow Adept',     class: 'dark',         behavior: 'aggressive', spellCount: 4, elo: 1100 },
  { id: 'abyssal_veteran',  name: 'Abyssal Veteran',  class: 'dark',         behavior: 'aggressive', spellCount: 7, elo: 1450 },

  { id: 'blade_novice',     name: 'Blade Novice',     class: 'sword',        behavior: 'docile',     spellCount: 2, elo: 800 },
  { id: 'duelist_adept',    name: 'Duelist Adept',    class: 'sword',        behavior: 'aggressive', spellCount: 4, elo: 1100 },
  { id: 'warlord_veteran',  name: 'Warlord Veteran',  class: 'sword',        behavior: 'aggressive', spellCount: 7, elo: 1450 },

  { id: 'sprout_novice',    name: 'Sprout Novice',    class: 'druid',        behavior: 'docile',     spellCount: 2, elo: 800 },
  { id: 'warden_adept',     name: 'Warden Adept',     class: 'druid',        behavior: 'aggressive', spellCount: 4, elo: 1100 },
  { id: 'wildwood_veteran', name: 'Wildwood Veteran', class: 'druid',        behavior: 'aggressive', spellCount: 7, elo: 1450 },

  { id: 'shard_novice',     name: 'Shard Novice',     class: 'crystalmancer', behavior: 'docile',     spellCount: 2, elo: 800 },
  { id: 'prism_adept',      name: 'Prism Adept',      class: 'crystalmancer', behavior: 'aggressive', spellCount: 4, elo: 1100 },
  { id: 'monolith_veteran', name: 'Monolith Veteran', class: 'crystalmancer', behavior: 'aggressive', spellCount: 7, elo: 1450 },
];

export const getDuelOpponent = (id) => DUEL_OPPONENTS.find((o) => o.id === id) ?? null;
