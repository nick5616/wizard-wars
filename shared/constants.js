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
export const RESPAWN_DELAY = 8000; // ms -- safety-net auto-respawn for AFK players; normal flow is player-initiated (see DeathScreen)

// Movement (Source engine-style ground/air acceleration -- see shared/movement.js)
export const GROUND_ACCEL = 5.5; // Source sv_accelerate default
export const AIR_ACCEL = 12; // Source sv_airaccelerate default -- combined with AIR_CAP_SPEED this is what enables bunny-hop strafe acceleration
export const GROUND_FRICTION = 9; // higher than Source's sv_friction default (4) -- stock value still felt like sliding on ice once real-world tick/frame jitter was layered on top
export const STOP_SPEED = 2.5; // below this speed, friction decelerates as if at this speed so players actually stop instead of sliding forever (Source sv_stopspeed, scaled to BASE_MOVE_SPEED)
export const AIR_CAP_SPEED = 1; // wishspeed clamp for air acceleration, scaled from Source's hardcoded 30ups air-strafe cap
export const MAX_AIR_JUMPS = 1; // double jump: one extra jump usable mid-air, refreshed on landing

// Gravity
export const GRAVITY = -18; // units/s^2

// Movement-curve aiming: strafing/backpedaling while casting a projectile or
// arc spell bends the shot, deterministically (not random spread) so it's a
// learnable tech -- lead your aim to compensate, or strafe on purpose to
// curve a shot around cover. See SpellSystem._castProjectile.
export const MOVE_CURVE_SPEED_CAP = 1.5; // multiple of BASE_MOVE_SPEED at which curve/arc-angle effect maxes out (covers bhop speeds)
export const MAX_CURVE_DEG = 14; // max lateral bend at full strafe speed
export const BASE_ARC_ANGLE_DEG = 38; // default lob angle for 'arc' spells, standing still
export const ARC_ANGLE_SWING_DEG = 16; // how much forward/backward movement flattens/steepens the lob
export const MIN_ARC_ANGLE_DEG = 15;
export const MAX_ARC_ANGLE_DEG = 55;

// Spell casting
export const MAX_EQUIPPED_SPELLS = 4;
export const CAST_MAX_RANGE = 80; // units

// Domain expansions
export const MAX_CONCURRENT_DOMAINS = 1;

// Skill tree — points come from leveling up, not from kills directly (a kill
// that doesn't cross a level threshold grants none), so "level" stays a
// meaningful milestone instead of skill points racing ahead of it.
export const STARTING_SKILL_POINTS = 1; // just enough for your class's first spell
export const POINTS_PER_LEVEL = 1;

// Death Note
export const DEATH_NOTE_DAMAGE_WINDOW = 10000; // 10s — must have hit target recently

// Classes
export const CLASSES = ['fire', 'ice', 'dark', 'sword', 'druid', 'crystalmancer'];
