import { create } from 'zustand';
import type {
  PlayerState, ProjectileState, EffectState, DomainState,
  Vec3, KillFeedEntry, WizardClass,
} from '../types/game.types';

interface LocalPlayerState {
  health: number;
  maxHealth: number;
  class: WizardClass | null;
  equippedSpells: (string | null)[];
  activeSlot: number;
  cooldowns: Record<string, number>; // ms remaining
  mobilityCD: number;
  activeEffects: Record<string, { expiresAt: number; stacks: number }>;
  skillPoints: number;
  level: number;
  xp: number;
  divergedBranch: Record<string, string>;
  unlockedNodes: string[];
  kills: number;
  isAlive: boolean;
  position: Vec3;
}

export interface VoteOption {
  id: string;
  label: string;
  description: string;
}

export interface VoteState {
  branchGroup: string;
  options: VoteOption[];
  expiresAt: number;
  totalMs: number;
}

export const NOTIFICATION_TTL_MS = 4000;

export interface NotificationEntry {
  id: string;
  text: string;
  color: string;
  at: number;
}

export interface DamageNumber {
  id: string;
  x: number;
  y: number;
  z: number;
  value: number;
  spawnedAt: number;
  color: string;
  fontSize: number;
}

interface GameState {
  // Server-authoritative state
  players: Record<string, PlayerState>;
  projectiles: Record<string, ProjectileState>;
  effects: Record<string, EffectState>;
  domains: Record<string, DomainState>;
  serverTick: number;
  lastServerTimestamp: number;

  // Local player (derived + predicted)
  local: LocalPlayerState;

  // UI state
  phase: 'connecting' | 'class_select' | 'playing' | 'dead' | 'skill_tree';
  killFeed: KillFeedEntry[];
  notifications: NotificationEntry[];
  voteState: VoteState | null;

  // Set by GAME_TICK reconciliation, consumed and cleared by CameraController
  serverCorrectedPos: Vec3 | null;

  // Floating damage numbers
  damageNumbers: DamageNumber[];

  // Setters
  setPhase: (p: GameState['phase']) => void;
  applyTick: (players: Record<string, PlayerState>, projectiles: Record<string, ProjectileState>, effects: Record<string, EffectState>, domains: Record<string, DomainState>, tick: number, ts: number, localId: string) => void;
  setLocalClass: (c: WizardClass) => void;
  setActiveSlot: (i: number) => void;
  setLocalCooldown: (spellId: string, ms: number) => void;
  tickLocalCooldowns: () => void;
  addKillFeedEntry: (entry: KillFeedEntry) => void;
  pushNotification: (text: string, color?: string) => void;
  pruneNotifications: () => void;
  setVoteState: (v: VoteState | null) => void;
  setLocalPosition: (pos: Vec3) => void;
  setLocalAlive: (v: boolean) => void;
  addUnlockedNode: (nodeId: string) => void;
  spawnDamageNumber: (x: number, y: number, z: number, value: number, isHeadshot?: boolean) => void;
  pruneDamageNumbers: () => void;

  // Input blocking while menus are open
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;

  // Dev tools
  debugMode: boolean;
  setDebugMode: (v: boolean) => void;
}

const defaultLocal: LocalPlayerState = {
  health: 200,
  maxHealth: 200,
  class: null,
  equippedSpells: [null, null, null, null],
  activeSlot: 0,
  cooldowns: {},
  mobilityCD: 0,
  activeEffects: {},
  skillPoints: 0,
  level: 1,
  xp: 0,
  divergedBranch: {},
  unlockedNodes: [],
  kills: 0,
  isAlive: false,
  position: { x: 0, y: 1.8, z: 0 },
};

export const useGameStore = create<GameState>((set, get) => ({
  players: {},
  projectiles: {},
  effects: {},
  domains: {},
  serverTick: 0,
  lastServerTimestamp: 0,
  local: { ...defaultLocal },
  phase: 'connecting',
  killFeed: [],
  notifications: [],
  voteState: null,
  serverCorrectedPos: null,
  damageNumbers: [],
  menuOpen: false,
  debugMode: false,

  setPhase: (phase) => set({ phase }),

  applyTick: (players, projectiles, effects, domains, tick, ts, localId) => {
    const localPlayer = players[localId];
    set((s) => ({
      players,
      projectiles,
      effects,
      domains,
      serverTick: tick,
      lastServerTimestamp: ts,
      local: localPlayer ? {
        ...s.local,
        health: localPlayer.health,
        maxHealth: localPlayer.maxHealth,
        class: localPlayer.class,
        equippedSpells: localPlayer.equippedSpells,
        cooldowns: localPlayer.cooldowns,
        activeEffects: localPlayer.activeEffects,
        skillPoints: localPlayer.skillPoints,
        level: localPlayer.level,
        xp: localPlayer.xp,
        divergedBranch: localPlayer.divergedBranch,
        unlockedNodes: localPlayer.unlockedNodes,
        kills: localPlayer.kills,
        isAlive: localPlayer.isAlive,
      } : s.local,
    }));
  },

  setLocalClass: (c) => set((s) => ({
    local: { ...s.local, class: c },
    phase: 'playing',
  })),

  setActiveSlot: (i) => set((s) => ({ local: { ...s.local, activeSlot: i } })),

  setLocalCooldown: (spellId, ms) => set((s) => ({
    local: { ...s.local, cooldowns: { ...s.local.cooldowns, [spellId]: ms } },
  })),

  tickLocalCooldowns: () => set((s) => {
    const updated: Record<string, number> = {};
    let changed = false;
    for (const [id, ms] of Object.entries(s.local.cooldowns)) {
      const next = Math.max(0, ms - 16);
      updated[id] = next;
      if (next !== ms) changed = true;
    }
    if (!changed) return s;
    return { local: { ...s.local, cooldowns: updated } };
  }),

  addKillFeedEntry: (entry) => set((s) => ({
    killFeed: [entry, ...s.killFeed].slice(0, 8),
  })),

  pushNotification: (text, color = '#ccddff') => set((s) => ({
    notifications: [{ id: `${Date.now()}-${Math.random()}`, text, color, at: Date.now() }, ...s.notifications].slice(0, 8),
  })),

  pruneNotifications: () => set((s) => {
    const cutoff = Date.now() - NOTIFICATION_TTL_MS;
    const next = s.notifications.filter((n) => n.at > cutoff);
    return next.length === s.notifications.length ? s : { notifications: next };
  }),

  setVoteState: (v) => set({ voteState: v }),

  setLocalPosition: (pos) => set((s) => ({ local: { ...s.local, position: pos } })),

  setLocalAlive: (v) => set((s) => ({ local: { ...s.local, isAlive: v } })),

  addUnlockedNode: (nodeId) => set((s) => ({
    local: { ...s.local, unlockedNodes: [...s.local.unlockedNodes, nodeId] },
  })),

  spawnDamageNumber: (x, y, z, value, isHeadshot = false) => set((s) => {
    const color = isHeadshot ? '#ffffff' : (value >= 100 ? '#ff2244' : value >= 50 ? '#ff7700' : '#ffee00');
    const fontSize = isHeadshot ? Math.min(48, 28 + Math.round(value / 10)) : (value >= 100 ? 32 : value >= 50 ? 24 : 18);
    const jx = (Math.random() - 0.5) * 2.2;
    const jz = (Math.random() - 0.5) * 2.2;
    const entry: DamageNumber = {
      id: `${Date.now()}-${Math.random()}`,
      x: x + jx, y, z: z + jz,
      value, spawnedAt: Date.now(),
      color, fontSize,
    };
    const next = [...s.damageNumbers, entry];
    return { damageNumbers: next.slice(-24) }; // cap at 24 simultaneous
  }),

  pruneDamageNumbers: () => set((s) => {
    const cutoff = Date.now() - 1800;
    const next = s.damageNumbers.filter(n => n.spawnedAt > cutoff);
    return next.length === s.damageNumbers.length ? s : { damageNumbers: next };
  }),

  setMenuOpen: (v) => set({ menuOpen: v }),
  setDebugMode: (v) => set({ debugMode: v }),
}));
