export type WizardClass = 'fire' | 'ice' | 'dark' | 'sword' | 'earth';
export type SpellType = 'projectile' | 'beam' | 'hitscan' | 'aoe' | 'domain' | 'direct' | 'passive' | 'mobility' | 'melee';

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
  lifesteal?: number;
  isBarrier?: boolean;
  barrierHealth?: number;
}

export interface PlayerState {
  id: string;
  username: string;
  class: WizardClass | null;
  isAlive: boolean;
  health: number;
  maxHealth: number;
  position: Vec3;
  yaw: number;
  pitch: number;
  equippedSpells: (string | null)[];
  cooldowns: Record<string, number>; // spellId → ms remaining
  activeEffects: Record<string, { expiresAt: number; stacks: number }>;
  skillPoints: number;
  level: number;
  xp: number;
  divergedBranch: Record<string, string>;
  unlockedNodes: string[];
  kills: number;
  ping: number;
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

export interface GameTickPayload {
  tick: number;
  timestamp: number;
  ackSeq: number;
  players: Record<string, PlayerState>;
  projectiles: Record<string, ProjectileState>;
  effects: Record<string, EffectState>;
  domains: Record<string, DomainState>;
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
  victim: string;
  spellId: string | null;
  at: number;
}
