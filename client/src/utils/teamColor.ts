import type { PlayerState } from '../types/game.types';

/** Red, blue, yellow, green, pink, orange -- indexed by team id (0-based, see Room.setupMatch/setupDuel). */
export const TEAM_COLORS = ['#e5484d', '#3b82f6', '#f5c518', '#43a047', '#ec4899', '#fb923c'];

/**
 * The hat color for a player on `team`. Teams of more than one player (2v2,
 * 5v5, the 6-team mode) get a shared team color so allies read at a glance;
 * solo "teams" -- 1v1 duels, the 5-way FFA, and anyone outside a match
 * (team === null, e.g. the shared lobby) -- keep their class color instead,
 * since there's no ally to signal and the class color is more informative.
 */
export function hatColorFor(team: number | null, classColor: string, players: Record<string, PlayerState>): string {
  if (team == null) return classColor;
  let count = 0;
  for (const p of Object.values(players)) {
    if (p.team === team && ++count > 1) return TEAM_COLORS[team % TEAM_COLORS.length];
  }
  return classColor;
}
