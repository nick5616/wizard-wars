# Audio assets

Drop exported files here with the exact names below and they activate automatically —
nothing else needs to change. Anything missing is silently skipped
(see `client/src/audio/AudioManager.ts`), so it's safe to fill this in incrementally.

The authoritative list (with per-sound volume/loop/pitch settings) is
`client/src/audio/soundManifest.ts`. This file is just the quick-reference checklist.

## Format

- **SFX** (one-shots, all < ~1s): export as **WAV, 44.1kHz, 16-bit**. They're small enough
  that compression isn't worth it, and WAV decodes instantly with zero latency — important
  for the hitscan weapon, which fires on a very short cooldown and can't afford a decode
  hitch. `AudioManager` also randomizes playback rate slightly on repeated hits (see
  `pitchVariance` in the manifest) so spamming one sound doesn't get fatiguing — no extra
  work needed from you, just export the single source hit.
- **Music** (loops/stings, tens of seconds to minutes): export as **OGG Vorbis, ~192-256kbps**.
  Much smaller than WAV at that length, no perceptible quality loss, and (unlike MP3) OGG
  loops sample-accurately with no encoder gap at the seam — matters for the arena loop.
  MP3 is only worth adding as a fallback if you want to support older iOS Safari; skip it
  otherwise.
- Normalize roughly to **-16 LUFS integrated** for music and **-1dB peak** for one-shots so
  everything sits at a consistent level in-engine without per-sound gain-riding.

## sfx/ (WAV)

Hitscan weapon: `hitscan_fire.wav`, `hitscan_impact_player.wav`, `hitscan_impact_env.wav`
Melee: `melee_swing.wav`, `melee_impact.wav`, `melee_whiff.wav`
Generic spell fallbacks: `spell_cast_generic.wav`, `spell_impact_generic.wav`, `spell_charge_loop.wav`, `domain_activate.wav`, `cast_denied.wav`
Wizard hat: `hat_tier_up.wav`, `hat_buff_proc.wav`, `hat_buff_expire.wav`
Vote prompt (F1/F2): `vote_open.wav`, `vote_hover.wav`, `vote_select.wav`, `vote_resolve_major.wav`, `vote_resolve_minor.wav`
Progression: `spell_unlocked.wav`, `auto_equip_swap.wav`, `level_up.wav`, `rank_up.wav`, `notify_generic.wav`
Death/respawn: `death_generic.wav`, `death_screen_open.wav`, `respawn_hover.wav`, `respawn_select.wav`, `respawn_confirm.wav`, `respawn_materialize.wav`
UI: `ui_click.wav`, `ui_open.wav`, `ui_close.wav`

## music/ (OGG)

`menu_loop.ogg`, `arena_loop.ogg`, `arena_intense_loop.ogg` (optional adaptive combat-intensity layer), `victory_sting.ogg`, `death_sting.ogg`
