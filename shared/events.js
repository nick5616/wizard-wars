// Client → Server
export const C2S = {
  CLOCK_SYNC:       'c2s:clock_sync',
  JOIN_ROOM:        'c2s:join_room',
  PLAYER_INPUT:     'c2s:player_input',
  EQUIP_SPELL:      'c2s:equip_spell',
  BUY_SKILL_NODE:   'c2s:buy_skill_node',
  SELECT_CLASS:     'c2s:select_class',
  RESPAWN:          'c2s:respawn',
  DEBUG_GRANT:      'c2s:debug_grant',
  SKILL_VOTE_RESOLVE: 'c2s:skill_vote_resolve',
  SPAWN_BOTS:       'c2s:spawn_bots',
  DESPAWN_BOTS:     'c2s:despawn_bots',
  // Experiment Lab (localhost-only, see Player.isLocalConnection)
  SPAWN_BOT:        'c2s:spawn_bot',
  DESPAWN_BOT:      'c2s:despawn_bot',
  SET_BOT_BEHAVIOR: 'c2s:set_bot_behavior',
  SET_BOT_LOADOUT:  'c2s:set_bot_loadout',
  SET_BOT_AUTO_EQUIP: 'c2s:set_bot_auto_equip',
  RUN_SIMULATION:   'c2s:run_simulation',
};

// Server → Client
export const S2C = {
  CLOCK_SYNC:       's2c:clock_sync',
  ROOM_JOINED:      's2c:room_joined',
  ROOM_STATE:       's2c:room_state',       // full state (on join)
  GAME_TICK:        's2c:game_tick',        // authoritative tick update
  PLAYER_JOINED:    's2c:player_joined',
  PLAYER_LEFT:      's2c:player_left',
  HIT_CONFIRMED:    's2c:hit_confirmed',
  HIT_DENIED:       's2c:hit_denied',
  PLAYER_DIED:      's2c:player_died',
  PLAYER_RESPAWNED: 's2c:player_respawned',
  SPELL_CAST:       's2c:spell_cast',       // server-confirmed cast
  SPELL_CAST_DENIED:'s2c:spell_cast_denied',
  DOMAIN_START:     's2c:domain_start',
  DOMAIN_END:       's2c:domain_end',
  KILL_FEED:        's2c:kill_feed',
  SKILL_BOUGHT:     's2c:skill_bought',
  LEVEL_UP:         's2c:level_up',
  HAT_BUFF_PROC:    's2c:hat_buff_proc',
  SKILL_AUTO_UNLOCKED: 's2c:skill_auto_unlocked',
  SKILL_VOTE_PROMPT:   's2c:skill_vote_prompt',
  ERROR:            's2c:error',
  // Experiment Lab
  SIMULATION_PROGRESS: 's2c:simulation_progress',
  SIMULATION_RESULT:   's2c:simulation_result',
};

// Input flags (bitmask for compact transmission)
export const INPUT_FLAGS = {
  FORWARD:  1 << 0,
  BACKWARD: 1 << 1,
  LEFT:     1 << 2,
  RIGHT:    1 << 3,
  JUMP:     1 << 4,
  MOBILITY: 1 << 5,
};
