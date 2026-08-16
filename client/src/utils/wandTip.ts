/**
 * Where a player's wand tip sits in world space, given their (eye-level)
 * position and yaw. Used to make purely-visual effects (beam cylinder,
 * hitscan tracer) originate from "the wand" instead of the eye/head, which
 * previously made beams in particular look like they fired from above the
 * caster's head. Not used for anything authoritative — server hit detection
 * is untouched, this only moves where we draw the line's start point.
 *
 * Local offset is expressed in (right, forward, up-from-feet) so it's
 * independent of yaw; wandTipWorldPosition rotates it into world space using
 * this codebase's yaw convention (forward = (-sin(yaw), -cos(yaw))).
 */

import { PLAYER_HEIGHT } from 'shared/constants';
import type { Vec3 } from '../types/game.types';

export const WAND_LOCAL_OFFSET = { right: 0.34, forward: 0.4, upFromFeet: 1.28 };

export function wandTipWorldPosition(eyeLevelPosition: Vec3, yaw: number): Vec3 {
  const feetY = eyeLevelPosition.y - PLAYER_HEIGHT;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const { right, forward, upFromFeet } = WAND_LOCAL_OFFSET;
  return {
    x: eyeLevelPosition.x + right * cos - forward * sin,
    y: feetY + upFromFeet,
    z: eyeLevelPosition.z - right * sin - forward * cos,
  };
}
