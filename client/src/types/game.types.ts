export type WizardClass = 'fire' | 'ice' | 'dark' | 'sword' | 'druid' | 'crystalmancer';
export type SpellType = 'projectile' | 'arc' | 'beam' | 'hitscan' | 'aoe' | 'domain' | 'direct' | 'passive' | 'mobility' | 'melee' | 'rune' | 'defensive';

export interface Vec3 { x: number; y: number; z: number; }

export interface SpellDef {
  id: string;
  name: string;
  school: string;
  tier: number;
  class: WizardClass;
  type: SpellType;
  damage: number;
  cooldown: number;
  manaCost: number;
  speed: number | null;
  radius: number;
  duration: number | null;
  statusEffect: string | null;
  statusDuration: number;
  selfCost: number | null;
  requiresTarget: boolean;
  interruptible: boolean;
  windupMs: number;
  serverAuthoritative: boolean;
  color: string;
  glowColor: string;
  piercing?: boolean;
  /** 'arc' spells only: which PROJECTILE_GRAVITY band they fall under (default 'normal'). */
  gravity?: 'none' | 'slight' | 'normal' | 'heavy';
  onImpact?: string;
  spreadCount?: number;
  spreadAngle?: number;
  lifesteal?: number;
  isBarrier?: boolean;
  barrierHealth?: number;
  selfCast?: boolean;
  length?: number;
  sniperSight?: boolean;
  wallPiercing?: boolean;
  destroysBarriers?: boolean;
  /** Named special-case behaviour handled in SpellSystem, e.g. 'gravity_well', 'launch_upward'. */
  effect?: string;
  /** Amaterasu: the burn never expires on its own. */
  isEternal?: boolean;
  /** Which subclass fork this spell belongs to, when it's fork-gated. */
  branch?: string;
  // Cast preconditions the server checks -- see SpellSystem._dispatchCast
  // and the DENY_REASON_TEXT map in App.tsx for the player-facing wording.
  requiresParry?: boolean;
  requiresRecentDamage?: boolean;
  requiresStatusEffect?: string;
  // Defensive spells (see shared/spells.js DEFENSIVE_SPELLS)
  damageReduction?: number;
  absorbAmount?: number;
  fullCounter?: boolean;
}

export interface PlayerState {
  id: string;
  username: string;
  class: WizardClass | null;
  team: number | null;
  isAlive: boolean;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  position: Vec3;
  yaw: number;
  pitch: number;
  equippedSpells: (string | null)[];
  activeSlot?: number;
  isChoosingBranch?: boolean;
  cooldowns: Record<string, number>; // spellId → ms remaining
  activeEffects: Record<string, { expiresAt: number; stacks: number }>;
  skillPoints: number;
  level: number;
  xp: number;
  divergedBranch: Record<string, string>;
  unlockedNodes: string[];
  revealedLore: string[];
  kills: number;
  elo: number;
  ping: number;
  isBot: boolean;
  defensiveActive?: boolean;
  parryActive?: boolean;
  phantomCasts?: number;
  // Bot-only (Experiment Lab)
  behavior?: 'static' | 'docile' | 'aggressive';
  autoEquipOnLevel?: boolean;
}

export interface ProjectileState {
  id: string;
  spellId: string;
  ownerId: string;
  position: Vec3;
  velocity: Vec3;
  createdAt: number;
  expiresAt: number;
  damage: number;
  radius: number;
  active: boolean;
}

export interface EffectState {
  id: string;
  type: string;
  spellId: string;
  ownerId: string;
  position?: Vec3;
  radius?: number;
  expiresAt: number;
  createdAt: number;
  active: boolean;
  // Hitscan flash specifics
  origin?: Vec3;
  direction?: Vec3;
  color?: string;
  glowColor?: string;
  school?: string;
  // AoE specifics
  startedAt?: number;
  activatesAt?: number;
  windupMs?: number;
  duration?: number;
  damage?: number;
  statusEffect?: string | null;
  shape?: 'point' | 'line';
  length?: number;
  triggered?: boolean;
  // Amaterasu specifics (persistent black-fire dot on a target)
  targetId?: string;
  // Chain lightning: every point the bolt passes through (caster, then each bounce target)
  points?: Vec3[];
}

export interface DomainState {
  id: string;
  spellId: string;
  ownerId: string;
  startedAt: number;
  activatesAt: number;
  expiresAt: number;
  active: boolean;
}

export interface BarrierState {
  id: string;
  ownerId: string;
  spellId: string;
  position: Vec3; // y is the barrier's vertical center
  width: number;
  height: number;
  health: number | null;
  breaksRemaining: number | null;
  expiresAt: number;
  active: boolean;
}

export interface GameTickPayload {
  tick: number;
  timestamp: number;
  ackSeq: number;
  players: Record<string, PlayerState>;
  projectiles: Record<string, ProjectileState>;
  effects: Record<string, EffectState>;
  domains: Record<string, DomainState>;
  barriers: Record<string, BarrierState>;
}

export interface PendingInput {
  seq: number;
  ts: number;
  flags: number;
  yaw: number;
  pitch: number;
  cast: CastInput | null;
  mobility: boolean;
  // predicted state after this input
  predictedPosition: Vec3;
}

export interface CastInput {
  spellId: string;
  slotIndex: number;
  aimDir: Vec3;
  targetId?: string;
}

export interface KillFeedEntry {
  killer: string;
  killerSymbol?: string;
  victim: string;
  victimSymbol?: string;
  spellId: string | null;
  at: number;
}

export interface SimulationResult {
  rounds: number;
  winRateByClass: Record<string, number>;
  // Index-disambiguated version of winRateByClass ([sideA rate, sideB rate])
  // -- the only reliable way to tell sides apart when both picked the same
  // class, which winRateByClass alone can't represent.
  winRateBySide?: [number, number];
  draws: number;
  avgTimeToKillMs: number | null;
  damageBySpell: Record<string, { totalDamage: number; hits: number }>;
}
