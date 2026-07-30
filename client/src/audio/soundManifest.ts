// Central registry of every sound the game can play. Drop the referenced file into
// client/public/audio/... to activate it -- until then AudioManager fails silently
// (see AudioManager.ts). Keys are stable IDs referenced from gameplay code; the `src`
// path is the only thing you need to fill in once a track/SFX is exported from Ableton.

export type SoundCategory = 'sfx' | 'music';

export interface SoundDef {
  category: SoundCategory;
  src: string; // relative to /audio/, served from client/public/audio/
  volume?: number; // 0-1 base multiplier, defaults to 1
  loop?: boolean;
  pitchVariance?: number; // +/- fraction randomized per play, e.g. 0.08 = +/-8%
}

function sfx(src: string, opts: Partial<SoundDef> = {}): SoundDef {
  return { category: 'sfx', src: `sfx/${src}`, volume: 1, ...opts };
}

function music(src: string, opts: Partial<SoundDef> = {}): SoundDef {
  return { category: 'music', src: `music/${src}`, volume: 1, loop: true, ...opts };
}

export const SOUND_MANIFEST: Record<string, SoundDef> = {
  // --- Hitscan weapon (always-available, weak, fast cooldown) ---
  hitscan_fire: sfx('hitscan_fire.wav', { pitchVariance: 0.08 }),
  hitscan_impact_player: sfx('hitscan_impact_player.wav', { pitchVariance: 0.08 }),
  hitscan_impact_env: sfx('hitscan_impact_env.wav', { pitchVariance: 0.08 }),

  // --- Melee (punch, etc.) ---
  melee_swing: sfx('melee_swing.wav', { pitchVariance: 0.06 }),
  melee_impact: sfx('melee_impact.wav', { pitchVariance: 0.06 }),
  melee_whiff: sfx('melee_whiff.wav', { pitchVariance: 0.06 }),

  // --- Generic spell fallbacks (used until/unless a spell gets a bespoke sound) ---
  spell_cast_generic: sfx('spell_cast_generic.wav'),
  spell_impact_generic: sfx('spell_impact_generic.wav'),
  spell_charge_loop: sfx('spell_charge_loop.wav', { loop: true }),
  domain_activate: sfx('domain_activate.wav'),
  cast_denied: sfx('cast_denied.wav', { volume: 0.6 }),

  // --- Wizard hat (level-scaling accessory, on-hit buff) ---
  hat_tier_up: sfx('hat_tier_up.wav'),
  hat_buff_proc: sfx('hat_buff_proc.wav'),
  hat_buff_expire: sfx('hat_buff_expire.wav'),

  // --- Skill-tree vote prompt (F1/F2, counterstrike-style) ---
  vote_open: sfx('vote_open.wav', { volume: 0.7 }),
  vote_hover: sfx('vote_hover.wav', { volume: 0.4 }),
  vote_select: sfx('vote_select.wav'),
  vote_resolve_major: sfx('vote_resolve_major.wav'), // diverging pick (tree branch choice)
  vote_resolve_minor: sfx('vote_resolve_minor.wav'), // ordinary node choice

  // --- Progression / unlock notifications ---
  spell_unlocked: sfx('spell_unlocked.wav'),
  auto_equip_swap: sfx('auto_equip_swap.wav', { volume: 0.5 }),
  level_up: sfx('level_up.wav'),
  rank_up: sfx('rank_up.wav'), // bigger sting: crossing a rank bucket (e.g. -> Archmage)
  notify_generic: sfx('notify_generic.wav', { volume: 0.5 }),

  // --- Death / respawn ---
  death_generic: sfx('death_generic.wav'),
  death_screen_open: sfx('death_screen_open.wav'),
  respawn_hover: sfx('respawn_hover.wav', { volume: 0.4 }),
  respawn_select: sfx('respawn_select.wav'),
  respawn_confirm: sfx('respawn_confirm.wav'),
  respawn_materialize: sfx('respawn_materialize.wav'),

  // --- Generic UI ---
  ui_click: sfx('ui_click.wav', { volume: 0.5 }),
  ui_open: sfx('ui_open.wav', { volume: 0.5 }),
  ui_close: sfx('ui_close.wav', { volume: 0.5 }),

  // --- Music beds ---
  music_menu: music('menu_loop.ogg', { volume: 0.6 }),
  music_arena: music('arena_loop.ogg', { volume: 0.5 }),
  music_arena_intense: music('arena_intense_loop.ogg', { volume: 0.5 }), // optional adaptive layer
  music_victory: music('victory_sting.ogg', { loop: false, volume: 0.7 }),
  music_death: music('death_sting.ogg', { loop: false, volume: 0.6 }),
};

export type SoundId = keyof typeof SOUND_MANIFEST;
