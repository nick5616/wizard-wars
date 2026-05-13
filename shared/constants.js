export const TICK_RATE = 64; // Hz
export const TICK_INTERVAL = 1000 / TICK_RATE; // ms

// Networking
export const INTERPOLATION_DELAY = 100; // ms — remote entities rendered this far in the past
export const STATE_HISTORY_MS = 500; // ms of state history for lag compensation
export const STATE_HISTORY_TICKS = Math.ceil((STATE_HISTORY_MS / 1000) * TICK_RATE); // ~32 ticks
export const CLOCK_SYNC_INTERVAL = 5000; // ms between clock sync attempts
export const MAX_CLOCK_SAMPLES = 8; // NTP samples to average

// Arena
export const ARENA_RADIUS = 30;
export const ARENA_WALL_HEIGHT = 8;
export const ARENA_FLOOR_Y = 0;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_CAPSULE_RADIUS = 0.4;

// Player
export const BASE_MOVE_SPEED = 8; // units/sec
export const SPRINT_MULTIPLIER = 1.6;
export const JUMP_FORCE = 6;
export const PLAYER_MAX_HEALTH = 200;
export const RESPAWN_DELAY = 3000; // ms

// Gravity
export const GRAVITY = -18; // units/s^2

// Spell casting
export const MAX_EQUIPPED_SPELLS = 4;
export const CAST_MAX_RANGE = 80; // units

// Domain expansions
export const MAX_CONCURRENT_DOMAINS = 1;

// Skill tree
export const STARTING_SKILL_POINTS = 3;
export const POINTS_PER_KILL = 2;
export const POINTS_PER_ASSIST = 1;

// Death Note
export const DEATH_NOTE_DAMAGE_WINDOW = 10000; // 10s — must have hit target recently

// Classes
export const CLASSES = ['fire', 'ice', 'dark', 'sword', 'earth'];
