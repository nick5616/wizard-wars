import { getSpell, BASIC_ATTACK, MELEE_ATTACK } from 'shared/spells';
import { terrainRaycastBlocked } from 'shared/mapLayout';
import { ARENA_RADIUS, CAST_MAX_RANGE } from 'shared/constants';

const DECISION_INTERVAL_MS = 150;
const AIM_INACCURACY_RAD = 0.03; // small cone of error so bots don't feel laser-perfect
const SIGHT_RANGE = 45;

/**
 * One controller per bot, driven from Room.update() at the real 64Hz physics
 * tick (so movement stays smooth) but only re-evaluates its "intent" every
 * DECISION_INTERVAL_MS. Feeds the exact same room.processInput(bot, input)
 * entry point real players use via WebSocketHandler — no special-cased
 * movement/combat code, only the decision-making here is bot-specific.
 */
export class BotController {
  constructor(bot, room) {
    this.bot = bot;
    this.room = room;
    this.nextDecisionAt = 0;
    this.movementFlags = 0;
    this.aimYaw = bot.yaw;
    this.strafeDir = Math.random() < 0.5 ? 'left' : 'right';
    this.nextStrafeFlipAt = 0;
  }

  /** Called every physics tick from Room.update(). */
  tick(now) {
    const bot = this.bot;
    if (!bot.isAlive) return;

    if (now >= this.nextDecisionAt) {
      this.nextDecisionAt = now + DECISION_INTERVAL_MS;
      this._decide(now);
    }

    const input = {
      seq: bot.nextInputSeq(),
      clientTimestamp: now,
      flags: this.movementFlags,
      yaw: this.aimYaw,
      pitch: 0,
      cast: this._takeOnce('pendingCast'),
      mobility: this._takeOnceBool('pendingMobility'),
      basicAttack: this._takeOnce('pendingBasicAttack'),
      melee: this._takeOnce('pendingMelee'),
    };

    this.room.processInput(bot, input);
  }

  _takeOnce(key) {
    const v = this[key] ?? null;
    this[key] = null;
    return v;
  }

  _takeOnceBool(key) {
    const v = !!this[key];
    this[key] = false;
    return v;
  }

  _decide(now) {
    const bot = this.bot;

    if (bot.behavior === 'static') {
      this.movementFlags = 0;
      return;
    }

    const target = this._selectTarget();
    if (!target) {
      this.movementFlags = 0;
      return;
    }

    const dx = target.position.x - bot.position.x;
    const dz = target.position.z - bot.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 0.001;
    const lookDir = { x: dx / dist, y: 0, z: dz / dist };
    this.aimYaw = Math.atan2(-lookDir.x, -lookDir.z);

    if (bot.behavior === 'docile') {
      this.movementFlags = this._computeMovement('retreat', bot, dist, 20);
      return;
    }

    // aggressive
    const hpFrac = bot.health / Math.max(1, bot.maxHealth);
    const targetHpFrac = target.health / Math.max(1, target.maxHealth);
    const preferredRange = bot.class === 'sword' ? 6 : 14;

    let state = 'engage';
    if (hpFrac < 0.25) state = 'retreat';
    else if (targetHpFrac < 0.3 && hpFrac > 0.4) state = 'burst';
    else if (hpFrac < targetHpFrac && dist < preferredRange) state = 'kite';

    this.movementFlags = this._computeMovement(state, bot, dist, preferredRange);
    this._chooseAction(bot, target, dist, lookDir, state, now);
  }

  _selectTarget() {
    const bot = this.bot;
    let best = null, bestDist = Infinity;
    for (const pid of this.room.playerIds) {
      if (pid === bot.id) continue;
      const p = this.room.server.players.get(pid);
      if (!p || !p.isAlive || p.isGodMode) continue;
      const dx = p.position.x - bot.position.x, dz = p.position.z - bot.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > SIGHT_RANGE) continue;
      if (dist < bestDist) { bestDist = dist; best = p; }
    }
    return best;
  }

  // ── Movement ───────────────────────────────────────────────────────────

  _computeMovement(state, bot, dist, preferredRange) {
    // Arena edge: always prioritize stepping back in, regardless of combat state.
    const radial = Math.sqrt(bot.position.x ** 2 + bot.position.z ** 2);
    if (radial > ARENA_RADIUS - 4) {
      const inwardYaw = Math.atan2(bot.position.x, bot.position.z); // faces the center given this codebase's yaw convention
      this.aimYaw = state === 'retreat' ? this.aimYaw : this.aimYaw; // keep aim on target; steer with strafe instead
      return this._flagsTowardYaw(inwardYaw);
    }

    let forward = false, backward = false;
    if (state === 'retreat') {
      backward = true;
    } else {
      if (dist > preferredRange + 2) forward = true;
      else if (dist < preferredRange - 3) backward = true;
    }

    const now = Date.now();
    if (now >= this.nextStrafeFlipAt) {
      this.nextStrafeFlipAt = now + 400 + Math.random() * 500;
      this.strafeDir = Math.random() < 0.5 ? 'left' : 'right';
    }

    let bits = 0;
    if (forward) bits |= 1;
    if (backward) bits |= 2;
    if (state !== 'retreat') bits |= this.strafeDir === 'left' ? 4 : 8;

    // Don't walk face-first into a wall — a short forward raycast, cancel forward if blocked.
    if (forward) {
      const origin = { x: bot.position.x, y: bot.position.y, z: bot.position.z };
      const dir = { x: -Math.sin(this.aimYaw), y: 0, z: -Math.cos(this.aimYaw) };
      if (terrainRaycastBlocked(origin, dir, 2.5) !== null) {
        bits &= ~1;
        bits |= 2; // back off instead of pushing into it
      }
    }

    return bits;
  }

  _flagsTowardYaw(yaw) {
    // Movement flags are relative to aimYaw (which callers keep pointed at the
    // target), so translate "I want to walk toward `yaw`" into forward/strafe
    // bits relative to aimYaw rather than overriding the aim direction.
    const dirX = -Math.sin(yaw), dirZ = -Math.cos(yaw);
    const fwdX = -Math.sin(this.aimYaw), fwdZ = -Math.cos(this.aimYaw);
    const rightX = -fwdZ, rightZ = fwdX; // 90° clockwise from forward
    const fwdDot = dirX * fwdX + dirZ * fwdZ;
    const rightDot = dirX * rightX + dirZ * rightZ;
    let bits = 0;
    bits |= fwdDot >= 0 ? 1 : 2;
    bits |= rightDot >= 0 ? 8 : 4;
    return bits;
  }

  // ── Action selection ─────────────────────────────────────────────────────

  _chooseAction(bot, target, dist, lookDir, state, now) {
    // Defensive Parry: occasionally raise it when a live threat is nearby and it's ready.
    const parrySpellId = bot.equippedSpells.find((id) => id === 'parry');
    if (parrySpellId && !bot.isOnCooldown('parry') && dist < 16 && Math.random() < 0.2) {
      const slotIndex = bot.equippedSpells.indexOf('parry');
      this.pendingCast = { spellId: 'parry', slotIndex, aimDir: lookDir };
      return;
    }

    const candidates = [];
    for (let i = 0; i < bot.equippedSpells.length; i++) {
      const id = bot.equippedSpells[i];
      if (!id || id === 'parry') continue;
      const spell = getSpell(id);
      if (!spell || bot.isOnCooldown(id)) continue;
      if (spell.type === 'domain' && this.room.getActiveDomain()) continue;
      if (spell.id === 'shatter' && !target.hasEffect('freeze')) continue;
      if (spell.id === 'death_note' && (bot.oncePerLifeUsed.has('death_note') || !bot.hasRecentDamageTo(target.id))) continue;
      if (spell.id === 'riposte' && !(bot.lastParryTime && now - bot.lastParryTime < 2000)) continue;
      if (spell.requiresTarget && spell.type === 'direct' && spell.id !== 'petrify' && spell.id !== 'amaterasu' && spell.id !== 'shatter' && spell.id !== 'death_note') continue;
      // Direct-target spells (shatter, petrify, amaterasu, death_note) now get
      // range/line-of-sight checked server-side too, but without this gate a
      // bot would keep "choosing" one the instant it's off cooldown from any
      // distance, sit there getting silently denied every decision tick, and
      // never actually close in on the target.
      if (spell.requiresTarget && (dist > CAST_MAX_RANGE || terrainRaycastBlocked(bot.position, lookDir, dist) !== null)) continue;
      candidates.push({ slotIndex: i, spell });
    }

    let best = null, bestScore = -Infinity;
    for (const c of candidates) {
      const score = this._scoreSpell(c.spell, dist, state);
      if (score > bestScore) { bestScore = score; best = c; }
    }

    if (best) {
      const aimDir = this._aimWithLead(bot, target, best.spell, dist, lookDir);
      this.pendingCast = {
        spellId: best.spell.id,
        slotIndex: best.slotIndex,
        aimDir,
        targetId: best.spell.requiresTarget ? target.id : undefined,
      };
      return;
    }

    // Escape via mobility when retreating and cornered-ish, or gap-close when bursting from far away
    const mobilityId = bot.mobilitySpell;
    if (mobilityId && !bot.isOnCooldown(mobilityId)) {
      if (state === 'retreat' || (state === 'burst' && dist > 12)) {
        this.pendingMobility = true;
        return;
      }
    }

    const basicId = BASIC_ATTACK[bot.class];
    if (basicId && !bot.isOnCooldown(basicId) && dist < 40) {
      this.pendingBasicAttack = { aimDir: lookDir };
      return;
    }

    const meleeId = MELEE_ATTACK[bot.class];
    const meleeSpell = meleeId ? getSpell(meleeId) : null;
    if (meleeSpell && !bot.isOnCooldown(meleeId) && dist < (meleeSpell.radius ?? 2.2) + 1) {
      this.pendingMelee = { aimDir: lookDir };
    }
  }

  _scoreSpell(spell, dist, state) {
    let score = spell.tier ?? 1;
    if (spell.type === 'domain') score += 50; // ultimates are strong enough to always prioritize when available
    if (spell.type === 'projectile') {
      const idealMax = (spell.speed ?? 20) > 25 ? 30 : 18;
      score -= Math.max(0, dist - idealMax) * 0.5;
    } else if (spell.type === 'aoe') {
      score -= Math.abs(dist - 10) * 0.4; // most aoe lands ~12 units out
    } else if (spell.type === 'beam') {
      score -= Math.max(0, dist - 18) * 0.6;
    }
    if (state === 'burst' && spell.damage > 60) score += 10;
    return score;
  }

  _aimWithLead(bot, target, spell, dist, lookDir) {
    let dir = { ...lookDir };
    if (spell.type === 'projectile' && spell.speed) {
      const t = dist / spell.speed;
      const leadX = target.position.x + (target.velocity?.x ?? 0) * t;
      const leadZ = target.position.z + (target.velocity?.z ?? 0) * t;
      const dx = leadX - bot.position.x, dz = leadZ - bot.position.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      dir = { x: dx / len, y: 0, z: dz / len };
    }
    // Small inaccuracy cone so bots aren't laser-perfect — widened by Dark
    // Unnerving Presence when the target has it unlocked and is close by (the
    // one passive that's only meaningful against bots, since real players aim
    // with a mouse and can't have their "accuracy" degraded server-side).
    const unnerved = target.unlockedNodes?.has('unnerving') && dist < 12;
    const inaccuracy = unnerved ? AIM_INACCURACY_RAD * 4 : AIM_INACCURACY_RAD;
    const noise = inaccuracy * (Math.random() - 0.5) * 2;
    const cos = Math.cos(noise), sin = Math.sin(noise);
    return { x: dir.x * cos - dir.z * sin, y: dir.y, z: dir.x * sin + dir.z * cos };
  }
}
