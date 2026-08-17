import { v4 as uuid } from 'uuid';
import { getSpell, MOBILITY_SPELL, BASIC_ATTACK, MELEE_ATTACK } from 'shared/spells';
import { S2C } from 'shared/events';
import { DOMAIN_CONFIGS } from 'shared/gameConfig';
import { MAX_CONCURRENT_DOMAINS, ARENA_RADIUS, PLAYER_HEIGHT, CAST_MAX_RANGE } from 'shared/constants';
import { hatCenterY, hatRadius } from 'shared/leveling';
import { terrainRaycastBlocked, rayIntersectsCylinder } from 'shared/mapLayout';

export class SpellSystem {
  constructor(room) {
    this.room = room;
  }

  handleCastRequest(player, castInput, clientTimestamp) {
    const { spellId, slotIndex, aimDir, targetId } = castInput;

    // Validate spell is equipped
    const equipped = player.equippedSpells[slotIndex];
    if (equipped !== spellId) return this._deny(player, spellId, 'not_equipped');

    const spell = getSpell(spellId);
    if (!spell) return this._deny(player, spellId, 'unknown_spell');

    // Bots don't send the continuous per-tick activeSlot a real client does
    // (see CameraController's input send / Room.processInput), so keep it in
    // sync with whatever they actually just cast -- otherwise a bot's
    // sniper-sight aim line (SniperSightLines.tsx) never reflects a spell
    // outside slot 0. Harmless no-op for human players, who already keep
    // this current every input tick.
    player.activeSlot = slotIndex;

    // Check alive and class match
    if (!player.isAlive) return this._deny(player, spellId, 'not_alive');
    if (spell.class !== player.class) return this._deny(player, spellId, 'wrong_class');
    if (player.hasEffect('stun')) return this._deny(player, spellId, 'stunned');
    if (player.pendingCast) return this._deny(player, spellId, 'casting');

    // Dark The Abyss: a primed free cast skips the cooldown check and (below) the windup entirely
    const isAbyssFreeCast = player.hasAbyssFreeCast;

    // Check cooldown — debug mode skips every cooldown gate in this file (see also
    // handleMobility / handleBasicAttack / handleMelee below).
    if (!isAbyssFreeCast && !player.isDebugMode && player.isOnCooldown(spellId)) {
      return this._deny(player, spellId, 'on_cooldown', player.getCooldownRemaining(spellId));
    }

    // Domain: only one active at a time globally
    if (spell.type === 'domain' && this.room.getActiveDomain()) {
      return this._deny(player, spellId, 'domain_active');
    }

    // Direct-target spells (shatter, petrify, amaterasu, death_note) must have
    // their target within cast range and unobstructed by terrain/barriers --
    // this had no server-side check at all, so any targetId landed instantly
    // regardless of distance or walls. Real players are implicitly limited by
    // needing the client's crosshair raycast to resolve a targetId in the
    // first place, but bots set targetId directly with no such gate, so
    // without this they could land Amaterasu etc. on an enemy anywhere on
    // the map the instant it left cooldown.
    if (spell.requiresTarget) {
      const target = this.room.server.players.get(targetId);
      if (!target || !target.isAlive) return this._deny(player, spellId, 'invalid_target');
      const dx = target.position.x - player.position.x;
      const dy = target.position.y - player.position.y;
      const dz = target.position.z - player.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
      if (dist > CAST_MAX_RANGE) return this._deny(player, spellId, 'out_of_range');
      const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
      const terrainBlockDist = terrainRaycastBlocked({ ...player.position }, dir, dist);
      const barrierBlock = this._barrierRayBlock({ ...player.position }, dir, dist);
      const blockDist = [terrainBlockDist, barrierBlock.distance].filter((d) => d !== null).sort((a, b) => a - b)[0] ?? null;
      if (blockDist !== null && blockDist < dist) return this._deny(player, spellId, 'no_line_of_sight');
    }

    // Death note special: once per life, must have recent damage
    if (spellId === 'death_note') {
      if (player.oncePerLifeUsed.has('death_note')) return this._deny(player, spellId, 'used_this_life');
      if (!targetId || !player.hasRecentDamageTo(targetId)) return this._deny(player, spellId, 'no_recent_damage');
      player.oncePerLifeUsed.add('death_note');
    }

    // Shatter: target must be frozen
    if (spellId === 'shatter') {
      const target = this.room.server.players.get(targetId);
      if (!target || !target.hasEffect('freeze')) return this._deny(player, spellId, 'target_not_frozen');
    }

    // Set cooldown — a primed Abyss free cast consumes the buff and skips it entirely;
    // debug mode never sets one at all, so the spell stays permanently ready.
    if (isAbyssFreeCast) {
      player.hasAbyssFreeCast = false;
    } else if (!player.isDebugMode) {
      player.setCooldown(spellId, spell.cooldown);
    }

    // Notify caster of confirmed cast (cooldown starts now, even for windup spells)
    this.room.server.send(player, {
      type: S2C.SPELL_CAST,
      spellId,
      slotIndex,
      cooldownMs: (isAbyssFreeCast || player.isDebugMode) ? 0 : spell.cooldown * 1000,
    });

    // Windup spells (aoe already has its own telegraph-then-resolve path via
    // activatesAt) resolve later instead of dispatching immediately, and can
    // be cancelled by taking damage if the spell is interruptible. The Abyss's
    // free cast is also instant — no windup, regardless of the spell.
    if (spell.windupMs > 0 && spell.type !== 'aoe' && !isAbyssFreeCast) {
      player.pendingCast = {
        spellId, spell, aimDir, targetId, clientTimestamp,
        readyAt: Date.now() + spell.windupMs,
        interruptible: !!spell.interruptible,
      };
      return;
    }

    this._dispatchCast(player, spell, aimDir, targetId, clientTimestamp);
  }

  /** Actually executes a validated, non-windup (or windup-resolved) cast. */
  _dispatchCast(player, spell, aimDir, targetId, clientTimestamp) {
    // Earth Geologic: any cast builds a defense stack (consumed/reset on taking a hit — see Room.applyDamage)
    if (player.class === 'earth' && player.unlockedNodes.has('geologic')) {
      player.geologicStacks = Math.min(4, player.geologicStacks + 1);
    }

    // Sword Iron Will: casting the Warlord-branch spell grants a brief incoming-damage reduction
    if (spell.id === 'blade_rain' && player.unlockedNodes.has('iron_will')) {
      player.ironWillExpiry = Date.now() + 3000;
    }

    // Dark The Abyss: Null Gaze primes the next cast to be free + instant (see handleCastRequest)
    if (spell.id === 'null_gaze' && player.unlockedNodes.has('the_abyss')) {
      player.hasAbyssFreeCast = true;
    }

    switch (spell.type) {
      case 'projectile': this._castProjectile(player, spell, aimDir, clientTimestamp); break;
      case 'beam':       this._castBeam(player, spell, aimDir, clientTimestamp); break;
      case 'hitscan':
        if (spell.bounces) this._castChainHitscan(player, spell, aimDir, clientTimestamp);
        else this._castHitscan(player, spell, aimDir, clientTimestamp);
        break;
      case 'aoe':        this._castAoe(player, spell, aimDir, clientTimestamp); break;
      case 'domain':     this._castDomain(player, spell); break;
      case 'direct':     this._castDirect(player, spell, targetId, clientTimestamp); break;
      case 'mobility':   this._castSlotMobility(player, spell); break;
      case 'rune':       this._castRune(player, spell, aimDir); break;
      default: break;
    }

    // Sword phantom blade: mirror next casts
    if (player.phantomCasts > 0 && spell.type !== 'domain' && spell.effect !== 'mirror_next_two_casts') {
      player.phantomCasts--;
      this._recastAsPhantom(player, spell, aimDir, targetId, clientTimestamp);
    }
  }

  /** Resolves any windup casts whose delay has elapsed, and clears expired-without-firing ones (e.g. player died mid-cast). */
  tickPendingCasts(now) {
    for (const pid of this.room.playerIds) {
      const player = this.room.server.players.get(pid);
      if (!player?.pendingCast) continue;
      if (!player.isAlive) { player.pendingCast = null; continue; }
      if (now < player.pendingCast.readyAt) continue;

      const { spell, aimDir, targetId, clientTimestamp } = player.pendingCast;
      player.pendingCast = null;
      this._dispatchCast(player, spell, aimDir, targetId, clientTimestamp);
    }
  }

  /**
   * Phantom Blade's mirrored re-cast: repeats the ORIGINAL spell's actual
   * effect (dispatched by its real type), not always a projectile — the
   * bogus zero-damage "phantom projectile" bug for aoe/hitscan/direct spells.
   * No cooldown is consumed (the caller already decremented a charge instead).
   */
  _recastAsPhantom(player, spell, aimDir, targetId, clientTimestamp) {
    switch (spell.type) {
      case 'projectile': this._castProjectile(player, spell, aimDir, clientTimestamp, true); break;
      case 'hitscan':    this._castHitscan(player, spell, aimDir, clientTimestamp); break;
      case 'beam':       this._castBeam(player, spell, aimDir, clientTimestamp); break;
      case 'aoe':        this._castAoe(player, spell, aimDir, clientTimestamp); break;
      case 'direct':     this._castDirect(player, spell, targetId, clientTimestamp); break;
      default: break;
    }
  }

  handleMobility(player, input) {
    const spellId = MOBILITY_SPELL[player.class];
    if (!spellId) return;
    if (!input?.mobilityForced && (!player.isAlive || player.hasEffect('stun'))) return;

    const spell = getSpell(spellId);
    if (!spell || (!player.isDebugMode && player.isOnCooldown(spellId))) return;

    if (!player.isDebugMode) player.setCooldown(spellId, spell.cooldown);

    switch (player.class) {
      case 'fire':  this._magmaDash(player, spell, input); break;
      case 'ice':   this._glacierStep(player, spell, input); break;
      case 'dark':  this._phaseSlip(player, spell, input); break;
      case 'sword': this._swordLunge(player, spell, input); break;
      case 'earth': this._stoneLaunch(player, spell); break;
    }
  }

  // ── Basic attack (RMB) & melee (F) ──────────────────────────────────────
  // Universal per-class abilities outside the equip slots -- always
  // available from spawn, no unlock needed. Same "outside the slot system"
  // treatment as handleMobility above.

  handleBasicAttack(player, aimDir, clientTimestamp) {
    const spellId = BASIC_ATTACK[player.class];
    if (!spellId || !player.isAlive || player.hasEffect('stun')) return;
    const spell = getSpell(spellId);
    if (!spell || (!player.isDebugMode && player.isOnCooldown(spellId))) return;

    if (!player.isDebugMode) player.setCooldown(spellId, spell.cooldown);
    this._castHitscan(player, spell, aimDir, clientTimestamp);
  }

  handleMelee(player, aimDir, clientTimestamp) {
    const spellId = MELEE_ATTACK[player.class];
    if (!spellId || !player.isAlive || player.hasEffect('stun')) return;
    const spell = getSpell(spellId);
    if (!spell || (!player.isDebugMode && player.isOnCooldown(spellId))) return;

    if (!player.isDebugMode) player.setCooldown(spellId, spell.cooldown);

    const range = spell.radius; // reused field as melee reach, see shared/spells.js MELEE_ATTACKS
    let hitPlayerId = null;
    let closestDist = Infinity;

    for (const pid of this.room.playerIds) {
      if (pid === player.id) continue;
      const target = this.room.server.players.get(pid);
      if (!target || !target.isAlive) continue;

      const dx = target.position.x - player.position.x;
      const dz = target.position.z - player.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > range || dist < 0.001) continue;

      // Forward-facing cone check (~60°), same dot-product approach as _resolveBeam
      const dot = (dx / dist) * aimDir.x + (dz / dist) * aimDir.z;
      if (dot < 0.5) continue;

      if (dist < closestDist) {
        closestDist = dist;
        hitPlayerId = pid;
      }
    }

    // Broadcast a lightweight swing visual regardless of whether it connected
    const swingId = uuid();
    this.room.effects.set(swingId, {
      id: swingId,
      type: 'melee_swing',
      spellId,
      ownerId: player.id,
      origin: { ...player.position },
      direction: aimDir,
      color: spell.color,
      glowColor: spell.glowColor,
      createdAt: Date.now(),
      expiresAt: Date.now() + 200,
      active: true,
    });

    if (!hitPlayerId) return;

    const target = this.room.server.players.get(hitPlayerId);
    const dmg = this.room.applyDamage(hitPlayerId, spell.damage, player.id, spellId);

    this.room.server.send(player, {
      type: S2C.HIT_CONFIRMED,
      targetId: hitPlayerId,
      spellId,
      damage: dmg,
      isHeadshot: false,
    });

    // Hat contact: extrapolate the aim ray out to the target's distance and see
    // if it lines up with their hat band, the same idea as the hitscan/projectile check.
    const travelY = player.position.y + aimDir.y * closestDist;
    const hatCenter = hatCenterY(target.position.y, target.level);
    if (Math.abs(travelY - hatCenter) < hatRadius(target.level) + 0.3) {
      this.room.progressionSystem.applyHatBuff(player.id, target.level);
    }
  }

  // ── Projectile ────────────────────────────────────────────────────────────

  _castProjectile(player, spell, aimDir, clientTimestamp, isPhantom = false) {
    const count = spell.spreadCount ?? 1;
    const baseAngle = spell.spreadAngle ?? 0;

    for (let i = 0; i < count; i++) {
      const id = uuid();
      let dir = { ...aimDir };

      if (count > 1) {
        const angle = ((i / (count - 1)) - 0.5) * (baseAngle * Math.PI / 180);
        const cos = Math.cos(angle), sin = Math.sin(angle);
        dir = {
          x: dir.x * cos - dir.z * sin,
          y: dir.y,
          z: dir.x * sin + dir.z * cos,
        };
      }

      this.room.projectiles.set(id, {
        id,
        spellId: spell.id,
        ownerId: player.id,
        position: { ...player.position }, // position.y is already eye level on server
        velocity: {
          x: dir.x * (spell.speed ?? 20),
          y: dir.y * (spell.speed ?? 20),
          z: dir.z * (spell.speed ?? 20),
        },
        createdAt: Date.now(),
        clientTimestamp,
        expiresAt: Date.now() + 8000,
        damage: spell.damage,
        radius: spell.radius ?? 0.5,
        statusEffect: spell.statusEffect,
        statusDuration: spell.statusDuration,
        piercing: spell.piercing ?? false,
        isPhantom,
        active: true,
      });
    }
  }

  // ── Hitscan ───────────────────────────────────────────────────────────────

  _castHitscan(player, spell, aimDir, clientTimestamp, { skipFlashOnHit = false } = {}) {
    // Determine compensation timestamp
    const compTimestamp = clientTimestamp - (player.rtt / 2);

    const result = this.room.lagCompensation.rayCast(
      { ...player.position }, // position.y is eye level
      aimDir,
      spell.radius ?? 0.5,
      player.id,
      compTimestamp,
    );

    // Walls/platforms and spell-cast barriers between the caster and the hit
    // point block it, unless the spell explicitly goes through walls.
    if (!spell.wallPiercing) {
      const probeDist = result.hit ? result.distance : CAST_MAX_RANGE;
      const terrainBlockDist = terrainRaycastBlocked({ ...player.position }, aimDir, probeDist);
      const barrierBlock = this._barrierRayBlock({ ...player.position }, aimDir, probeDist);

      if (barrierBlock.distance !== null) {
        this._damageBarrier(barrierBlock.barrier, spell.damage);
      }

      const blockingDistances = [terrainBlockDist];
      if (barrierBlock.distance !== null && !spell.destroysBarriers) blockingDistances.push(barrierBlock.distance);
      const blockDist = blockingDistances.filter((d) => d !== null).sort((a, b) => a - b)[0] ?? null;
      if (result.hit && blockDist !== null && blockDist < result.distance) result.hit = false;
    }

    // Broadcast visual (everyone sees the beam regardless) — chain lightning
    // suppresses this on a hit since it draws its own connect-the-dots arc
    // through every bounce instead (see _castChainHitscan).
    if (!(skipFlashOnHit && result.hit)) {
      const flashId = uuid();
      this.room.effects.set(flashId, {
        id: flashId,
        type: 'hitscan_flash',
        spellId: spell.id,
        ownerId: player.id,
        origin: { ...player.position },
        direction: aimDir,
        color: spell.color,
        glowColor: spell.glowColor,
        createdAt: Date.now(),
        expiresAt: Date.now() + 500,
        active: true,
      });
    }

    if (result.hit) {
      const target = this.room.server.players.get(result.playerId);

      // Parry: reflect the shot back at its caster instead of landing.
      if (target?.parryActive && Date.now() < target.parryExpiry && !spell.bypassesParry) {
        target.parryActive = false;
        target.lastParryTime = Date.now();
        target.lastParriedBy = player.id;
        this._onParrySuccess(target);
        this.room.applyDamage(player.id, spell.damage, target.id, spell.id);
        return null;
      }

      let dmgMult = result.isHeadshot ? 1.5 : 0.85;
      // Divine Judgement: "instant shatter on frozen" — a 0-duration freeze is a
      // no-op status, so the payoff is a burst multiplier against an already-frozen target.
      if (spell.statusEffect === 'freeze' && spell.statusDuration === 0 && target?.hasEffect('freeze')) {
        dmgMult *= 2.5;
      }
      const dmg = this.room.applyDamage(result.playerId, Math.round(spell.damage * dmgMult), player.id, spell.id, result.isHeadshot);
      if (target && spell.statusEffect) {
        target.applyEffect(spell.statusEffect, spell.statusDuration, 1, player.id);
      }
      if (result.isHatHit) this.room.progressionSystem.applyHatBuff(player.id, result.targetLevel);

      this.room.server.send(player, {
        type: S2C.HIT_CONFIRMED,
        targetId: result.playerId,
        spellId: spell.id,
        damage: dmg,
        isHeadshot: result.isHeadshot,
      });

      return result.playerId;
    }

    return null;
  }

  // ── Chain hitscan (Chain Lightning) ─────────────────────────────────────
  // The first hit is a normal aimed hitscan (lag comp, terrain/barrier
  // blocking, parry all apply); each additional bounce jumps to the nearest
  // not-yet-hit living enemy within range of the last hit, proximity-based
  // rather than re-aimed — the caster aims the first shot, not the chain.

  _castChainHitscan(player, spell, aimDir, clientTimestamp) {
    // skipFlashOnHit: on an actual hit, the chain's own 'chain_lightning'
    // effect (built below) draws the full connect-the-dots arc instead of
    // the generic full-range hitscan tracer.
    const firstTargetId = this._castHitscan(player, spell, aimDir, clientTimestamp, { skipFlashOnHit: true });
    if (!firstTargetId) return;

    const points = [{ ...player.position }];
    let fromPos = this.room.server.players.get(firstTargetId)?.position;
    points.push({ ...fromPos });

    const hitIds = new Set([player.id, firstTargetId]);
    const remainingBounces = Math.max(0, (spell.bounces ?? 1) - 1);
    const maxChainRange = 12;

    for (let i = 0; i < remainingBounces && fromPos; i++) {
      let nearestId = null, nearestDist = Infinity;
      for (const pid of this.room.playerIds) {
        if (hitIds.has(pid)) continue;
        const p = this.room.server.players.get(pid);
        if (!p || !p.isAlive) continue;
        const dx = p.position.x - fromPos.x, dz = p.position.z - fromPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < maxChainRange && dist < nearestDist) { nearestDist = dist; nearestId = pid; }
      }
      if (!nearestId) break;

      hitIds.add(nearestId);
      const next = this.room.server.players.get(nearestId);
      const dmg = this.room.applyDamage(nearestId, spell.damage, player.id, spell.id);
      if (spell.statusEffect) next.applyEffect(spell.statusEffect, spell.statusDuration, 1, player.id);

      this.room.server.send(player, {
        type: S2C.HIT_CONFIRMED,
        targetId: nearestId,
        spellId: spell.id,
        damage: dmg,
        isHeadshot: false,
      });

      points.push({ ...next.position });
      fromPos = next.position;
    }

    // One effect for the whole chain — the client draws a jagged, crackling
    // yellow arc through every point instead of a flat straight tracer per
    // segment, so the bolt visibly connects each bounce target.
    const chainId = uuid();
    this.room.effects.set(chainId, {
      id: chainId,
      type: 'chain_lightning',
      spellId: spell.id,
      ownerId: player.id,
      points,
      color: spell.color,
      glowColor: spell.glowColor,
      createdAt: Date.now(),
      expiresAt: Date.now() + 450,
      active: true,
    });
  }

  // ── Beam ─────────────────────────────────────────────────────────────────

  _castBeam(player, spell, aimDir, clientTimestamp) {
    const beamId = uuid();
    this.room.effects.set(beamId, {
      id: beamId,
      type: 'beam',
      spellId: spell.id,
      ownerId: player.id,
      direction: aimDir,
      damage: spell.damage,
      lifesteal: spell.lifesteal ?? 0,
      statusEffect: spell.statusEffect,
      statusDuration: spell.statusDuration,
      startedAt: Date.now(),
      expiresAt: Date.now() + (spell.duration ?? 2) * 1000,
      active: true,
    });
  }

  // ── AoE ───────────────────────────────────────────────────────────────────

  _castAoe(player, spell, aimDir, clientTimestamp) {
    if (spell.isBarrier) {
      this._createBarrier(player, spell, aimDir);
      return;
    }

    const effectId = uuid();
    // Self-centered spells (Blood Nova) land on the caster; line-shaped spells
    // (Fissure) start at the caster's feet and extend out via direction*length;
    // everything else casts at a fixed distance out along the aim direction,
    // snapping onto a player's feet if the crosshair is over one -- every
    // aimed aoe works this way now, not just Lightning Strike, so the ground
    // reticle (AoeTargetReticle.tsx) is always telling the truth about where
    // it'll land.
    let targetPos;
    if (spell.selfCast || spell.length) {
      targetPos = { x: player.position.x, y: 0, z: player.position.z };
    } else {
      targetPos = this._groundTargetPos(player, aimDir, 12);
    }

    const effect = {
      id: effectId,
      type: 'aoe',
      spellId: spell.id,
      ownerId: player.id,
      position: targetPos,
      radius: spell.radius ?? 3,
      damage: spell.damage,
      statusEffect: spell.statusEffect,
      statusDuration: spell.statusDuration,
      lifesteal: spell.lifesteal ?? 0,
      // Line-shaped aoe (Fissure): a capsule along the caster's aim direction
      // instead of a circle centered on targetPos.
      shape: spell.length ? 'line' : 'point',
      direction: spell.length ? { x: aimDir.x, z: aimDir.z } : null,
      length: spell.length ?? 0,
      windupMs: spell.windupMs ?? 0,
      duration: spell.duration ?? 0,
      startedAt: Date.now(),
      activatesAt: Date.now() + (spell.windupMs ?? 0),
      expiresAt: Date.now() + (spell.windupMs ?? 0) + ((spell.duration ?? 0.5) * 1000),
      triggered: false,
      active: true,
    };

    this.room.effects.set(effectId, effect);

    // Fire Backdraft's trigger window: Immolate coats the caster in fire for its duration.
    if (spell.id === 'immolate') {
      player.immolateActiveUntil = Date.now() + (spell.duration ?? 5) * 1000;
    }
  }

  // ── Runes ─────────────────────────────────────────────────────────────────
  // Placed on the ground a short distance out along aim, same fixed-distance
  // convention as a regular aoe cast. Arms after a brief delay (so the caster
  // can't detonate it on themselves by walking through it immediately), then
  // sits live until either the first enemy walks into it (one-shot trigger,
  // full damage/status/lifesteal via _resolveAoe) or its duration runs out
  // unfired. See tickEffects for the arm/trigger tick.

  _castRune(player, spell, aimDir) {
    const id = uuid();
    const position = { x: player.position.x + aimDir.x * 8, y: 0, z: player.position.z + aimDir.z * 8 };

    this.room.effects.set(id, {
      id,
      type: 'rune',
      spellId: spell.id,
      ownerId: player.id,
      position,
      radius: spell.radius ?? 2,
      damage: spell.damage,
      statusEffect: spell.statusEffect,
      statusDuration: spell.statusDuration,
      lifesteal: spell.lifesteal ?? 0,
      shape: 'point',
      armedAt: Date.now() + (spell.armMs ?? 400),
      startedAt: Date.now(),
      expiresAt: Date.now() + (spell.duration ?? 18000),
      triggered: false,
      active: true,
    });
  }

  // ── Barriers (Ice Wall, Rock Wall) ──────────────────────────────────────

  _createBarrier(player, spell, aimDir) {
    const id = uuid();
    const distance = 4;
    const height = spell.id === 'rock_wall' ? 4 : 3.5;
    const width = 6;
    // Earth Bulwark Stance: your own barriers are tougher
    const bulwark = player.unlockedNodes.has('bulwark_stance') ? 1.5 : 1;

    this.room.barriers.set(id, {
      id,
      ownerId: player.id,
      spellId: spell.id,
      position: {
        x: player.position.x + aimDir.x * distance,
        y: height / 2,
        z: player.position.z + aimDir.z * distance,
      },
      width,
      height,
      health: spell.barrierHealth != null ? Math.round(spell.barrierHealth * bulwark) : null,
      breaksRemaining: spell.requiresBreaks ?? null,
      createdAt: Date.now(),
      expiresAt: Date.now() + (spell.duration ?? 10) * 1000,
      active: true,
    });
  }

  /** Chips a barrier's health/break-count; deactivates it once depleted. */
  _damageBarrier(barrier, damage) {
    if (!barrier || !barrier.active) return;
    if (barrier.breaksRemaining != null) {
      barrier.breaksRemaining -= 1;
      if (barrier.breaksRemaining <= 0) barrier.active = false;
    } else if (barrier.health != null) {
      barrier.health -= damage;
      if (barrier.health <= 0) barrier.active = false;
    }
  }

  /** Nearest active barrier a ray hits within maxDist, or {distance:null} if none. */
  _barrierRayBlock(origin, dir, maxDist) {
    let distance = null;
    let barrier = null;
    for (const [, b] of this.room.barriers) {
      if (!b.active) continue;
      const t = rayIntersectsCylinder(origin, dir, {
        x: b.position.x, z: b.position.z, radius: b.width / 2,
        baseY: b.position.y - b.height / 2, height: b.height,
      });
      if (t !== null && t <= maxDist && (distance === null || t < distance)) {
        distance = t;
        barrier = b;
      }
    }
    return { distance, barrier };
  }

  /**
   * Ground-target point for every aim-and-click aoe spell: if the aim ray
   * hits an enemy's capsule within maxDist, center on their feet; otherwise
   * fall back to the normal fixed-distance point along aimDir. Mirrors the
   * client-side preview reticle's own raycast (see AoeTargetReticle.tsx) so
   * what you see before casting matches where the spell actually lands.
   */
  _groundTargetPos(player, aimDir, maxDist) {
    const origin = { ...player.position };
    let nearestDist = null;
    let nearestPlayer = null;
    for (const pid of this.room.playerIds) {
      if (pid === player.id) continue;
      const target = this.room.server.players.get(pid);
      if (!target || !target.isAlive) continue;
      const t = rayIntersectsCylinder(origin, aimDir, {
        x: target.position.x, z: target.position.z, radius: 0.6,
        baseY: target.position.y - PLAYER_HEIGHT, height: PLAYER_HEIGHT + 0.3,
      });
      if (t !== null && t <= maxDist && (nearestDist === null || t < nearestDist)) {
        nearestDist = t;
        nearestPlayer = target;
      }
    }
    if (nearestPlayer) return { x: nearestPlayer.position.x, y: 0, z: nearestPlayer.position.z };
    return { x: player.position.x + aimDir.x * maxDist, y: 0, z: player.position.z + aimDir.z * maxDist };
  }

  // ── Domain ────────────────────────────────────────────────────────────────

  _castDomain(player, spell) {
    const domainId = uuid();
    const config = DOMAIN_CONFIGS[spell.id];
    const now = Date.now();

    const domain = {
      id: domainId,
      spellId: spell.id,
      ownerId: player.id,
      startedAt: now,
      activatesAt: now + (config?.telegraph ?? 0),
      expiresAt: now + (config?.duration ?? 4000),
      active: true,
    };

    this.room.domains.set(domainId, domain);

    this.room.server.broadcast(this.room.id, {
      type: S2C.DOMAIN_START,
      domain,
    });
  }

  // ── Direct ────────────────────────────────────────────────────────────────

  _castDirect(player, spell, targetId, clientTimestamp) {
    // Self-cast direct spells (Parry) have no target at all — only fetch/require
    // one for spells that actually declare requiresTarget.
    const target = spell.requiresTarget ? this.room.server.players.get(targetId) : null;
    if (spell.requiresTarget && (!target || !target.isAlive)) return;

    if (spell.id === 'death_note') {
      // The windup (server-enforced via pendingCast) already elapsed by the time
      // we get here — deal damage immediately.
      this.room.applyDamage(targetId, spell.damage, player.id, spell.id);
      return;
    }

    if (spell.id === 'shatter') {
      target.removeEffect('freeze');
      this.room.applyDamage(targetId, spell.damage, player.id, spell.id);
      // Ice Glass Cannon: shattering a frozen target resets Glacial Spike's cooldown
      if (player.unlockedNodes.has('glass_cannon')) player.cooldowns.delete('glacial_spike');
      return;
    }

    if (spell.id === 'petrify') {
      target.applyEffect('petrify', spell.statusDuration, 1, player.id);
      return;
    }

    // Phantom blade: set up mirroring
    if (spell.id === 'phantom_blade') {
      player.phantomCasts = player.unlockedNodes.has('razors_edge') ? 3 : 2;
      return;
    }

    // Parry: opens a short self-buff window (no target) — reflection is
    // resolved where hits are, see _castHitscan / tickProjectiles.
    if (spell.id === 'parry') {
      player.parryActive = true;
      player.parryExpiry = Date.now() + (spell.duration ?? 0.6) * 1000;
      return;
    }

    // Amaterasu: apply eternal burn
    if (spell.id === 'amaterasu') {
      const burnId = uuid();
      this.room.effects.set(burnId, {
        id: burnId,
        type: 'amaterasu',
        spellId: 'amaterasu',
        ownerId: player.id,
        targetId,
        damage: spell.damage,
        tickInterval: 500,
        nextTick: Date.now() + 500,
        expiresAt: Date.now() + 30000,
        active: true,
      });
      return;
    }

    // Generic direct damage — only reachable for requiresTarget spells with no
    // special branch above; self-cast spells with their own behavior (Parry)
    // get an explicit branch instead of falling through here.
    if (!target) return;
    const dmg = this.room.applyDamage(targetId, spell.damage, player.id, spell.id);
    if (spell.statusEffect) target.applyEffect(spell.statusEffect, spell.statusDuration, 1, player.id);
  }

  /** Sword Counter: a successful parry resets Iron Edge and primes the next one to hit doubled. */
  _onParrySuccess(parrier) {
    if (!parrier.unlockedNodes.has('counter')) return;
    parrier.cooldowns.delete('iron_edge');
    parrier.empoweredSlashReady = true;
  }

  // ── Slot-equipped mobility spells (type:'mobility' in an equip slot, as
  // opposed to the one per-class spell bound to Shift — see handleMobility) ──

  _castSlotMobility(player, spell) {
    if (spell.id === 'riposte') return this._castRiposte(player, spell);
  }

  _castRiposte(player, spell) {
    const withinWindow = !spell.requiresParry || (player.lastParryTime && (Date.now() - player.lastParryTime) < 2000);
    if (!withinWindow) return;

    const target = player.lastParriedBy ? this.room.server.players.get(player.lastParriedBy) : null;
    if (!target || !target.isAlive) return;

    if (spell.teleportToTarget) {
      const dx = player.position.x - target.position.x;
      const dz = player.position.z - target.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz) || 1;
      player.position.x = target.position.x + (dx / dist) * 1.5;
      player.position.z = target.position.z + (dz / dist) * 1.5;
    }

    this.room.applyDamage(target.id, spell.damage, player.id, spell.id);
    player.lastParryTime = 0; // consume the window — one riposte per parry
  }

  // ── Tick projectiles ──────────────────────────────────────────────────────

  tickProjectiles(dt, now) {
    const toRemove = [];

    for (const [id, proj] of this.room.projectiles) {
      if (!proj.active || now > proj.expiresAt) {
        toRemove.push(id);
        continue;
      }

      // Domain effects: Inferno Domain accelerates projectiles, Event Horizon pulls them center-ward
      const activeDomain = this.room.getActiveDomain();
      if (activeDomain && now >= activeDomain.activatesAt) {
        const domainConfig = DOMAIN_CONFIGS[activeDomain.spellId];
        if (activeDomain.spellId === 'inferno_domain' && domainConfig) {
          const accel = 1 + ((domainConfig.accelerationFactor ?? 1) - 1) * dt;
          proj.velocity.x *= accel; proj.velocity.y *= accel; proj.velocity.z *= accel;
        } else if (activeDomain.spellId === 'event_horizon' && domainConfig) {
          const pdx = -proj.position.x, pdz = -proj.position.z;
          const pdist = Math.sqrt(pdx * pdx + pdz * pdz);
          if (pdist > 0.5) {
            const pull = (domainConfig.pullForce ?? 0) * dt;
            proj.velocity.x += (pdx / pdist) * pull;
            proj.velocity.z += (pdz / pdist) * pull;
          }
        }
      }

      // Move projectile
      const prevPos = { x: proj.position.x, y: proj.position.y, z: proj.position.z };
      proj.position.x += proj.velocity.x * dt;
      proj.position.y += proj.velocity.y * dt;
      proj.position.z += proj.velocity.z * dt;

      // Apply gravity (most projectiles have none or slight gravity)
      // None for now — can extend per spell

      // Boundary check
      const dx = proj.position.x, dz = proj.position.z;
      if (Math.sqrt(dx * dx + dz * dz) > ARENA_RADIUS + 2 || proj.position.y < -5) {
        toRemove.push(id);
        continue;
      }

      // Terrain collision — a wall/platform crossed this tick's movement segment
      const projSpell = getSpell(proj.spellId);
      if (!projSpell?.wallPiercing) {
        const segX = proj.position.x - prevPos.x, segY = proj.position.y - prevPos.y, segZ = proj.position.z - prevPos.z;
        const segLen = Math.sqrt(segX * segX + segY * segY + segZ * segZ);
        if (segLen > 1e-6) {
          const segDir = { x: segX / segLen, y: segY / segLen, z: segZ / segLen };
          const blockDist = terrainRaycastBlocked(prevPos, segDir, segLen);
          if (blockDist !== null) {
            toRemove.push(id);
            continue;
          }
        }
      }

      // Barrier collision
      let hitBarrier = false;
      for (const [, barrier] of this.room.barriers) {
        if (barrier.active && this._projectileHitsBarrier(proj, barrier)) {
          this._damageBarrier(barrier, proj.damage);
          if (!projSpell?.destroysBarriers) {
            toRemove.push(id);
            hitBarrier = true;
          }
          break;
        }
      }
      if (hitBarrier) continue;

      // Hit detection against current authoritative positions.
      // player.position.y is eye level; body center = pos.y - 0.9, head center = pos.y - 0.2
      const hits = [];
      for (const pid of this.room.playerIds) {
        if (pid === proj.ownerId) continue;
        const target = this.room.server.players.get(pid);
        if (!target || !target.isAlive) continue;
        const tx = target.position.x, tz = target.position.z;
        const headY = target.position.y - 0.2;
        const bodyY = target.position.y - 0.9;
        const dx = proj.position.x - tx, dz = proj.position.z - tz;
        const dyHead = proj.position.y - headY, dyBody = proj.position.y - bodyY;
        const headDist = Math.sqrt(dx*dx + dyHead*dyHead + dz*dz);
        const bodyDist = Math.sqrt(dx*dx + dyBody*dyBody + dz*dz);
        const isHeadshot = headDist < proj.radius + 0.22;
        const isBodyHit = bodyDist < proj.radius + 0.5;
        const hatCenter = hatCenterY(target.position.y, target.level);
        const isHatHit = Math.sqrt(dx*dx + (proj.position.y - hatCenter) ** 2 + dz*dz) < hatRadius(target.level) + proj.radius;
        if (isHeadshot || isBodyHit) hits.push({ playerId: pid, isHeadshot, isHatHit, targetLevel: target.level });
      }

      for (const { playerId, isHeadshot, isHatHit, targetLevel } of hits) {
        const target = this.room.server.players.get(playerId);
        if (!target || !target.isAlive) continue;

        // Parry: send the projectile back the way it came, now owned by the parrier.
        if (target.parryActive && Date.now() < target.parryExpiry && !projSpell?.bypassesParry) {
          target.parryActive = false;
          target.lastParryTime = Date.now();
          target.lastParriedBy = proj.ownerId;
          this._onParrySuccess(target);
          proj.velocity.x *= -1;
          proj.velocity.y *= -1;
          proj.velocity.z *= -1;
          proj.ownerId = playerId;
          continue;
        }

        const dmgMult = isHeadshot ? 1.5 : 0.85;
        const dmg = this.room.applyDamage(playerId, Math.round(proj.damage * dmgMult), proj.ownerId, proj.spellId, isHeadshot);
        if (proj.statusEffect && target) {
          target.applyEffect(proj.statusEffect, proj.statusDuration, 1, proj.ownerId);
        }
        if (isHatHit) this.room.progressionSystem.applyHatBuff(proj.ownerId, targetLevel);

        // Lifesteal
        const owner = this.room.server.players.get(proj.ownerId);
        if (owner && projSpell?.lifesteal) {
          owner.health = Math.min(owner.maxHealth, owner.health + Math.round(dmg * projSpell.lifesteal));
        }

        // Void Bloom: onImpact spawns a lingering slow/damage zone at the hit point
        if (projSpell?.onImpact === 'void_tendrils') {
          this._spawnVoidTendrils({ ...proj.position }, proj.ownerId);
        }

        this.room.server.send(owner, {
          type: S2C.HIT_CONFIRMED,
          targetId: playerId,
          spellId: proj.spellId,
          damage: dmg,
          isHeadshot,
        });

        if (!proj.piercing) {
          toRemove.push(id);
          break;
        }
      }

      // Floor collision → AoE explosion if the spell has a radius
      if (proj.position.y <= 0.1 && proj.radius > 0.8) {
        this._explodeAtPosition(proj);
        toRemove.push(id);
      }
    }

    for (const id of toRemove) this.room.projectiles.delete(id);
  }

  // ── Tick effects (AoE, beams, Amaterasu) ─────────────────────────────────

  tickEffects(dt, now) {
    const toRemove = [];

    for (const [id, effect] of this.room.effects) {
      if (!effect.active || now > effect.expiresAt) {
        toRemove.push(id);
        continue;
      }

      if (effect.type === 'aoe' && !effect.triggered && now >= effect.activatesAt) {
        effect.triggered = true;
        this._resolveAoe(effect, now);
        if (!effect.duration) toRemove.push(id);
      }

      if (effect.type === 'aoe' && effect.triggered && effect.duration > 0) {
        // Lingering AoE — tick damage
        if (!effect.lastTick || now - effect.lastTick >= 500) {
          effect.lastTick = now;
          this._resolveAoe(effect, now, true);
        }
      }

      if (effect.type === 'beam') {
        this._resolveBeam(effect, now, dt);
      }

      if (effect.type === 'rune' && !effect.triggered && now >= effect.armedAt) {
        let steppedOn = false;
        for (const pid of this.room.playerIds) {
          if (pid === effect.ownerId) continue;
          const p = this.room.server.players.get(pid);
          if (p?.isAlive && this._effectContainsPoint(effect, p.position)) { steppedOn = true; break; }
        }
        if (steppedOn) {
          effect.triggered = true;
          this._resolveAoe(effect, now);
          // Keep it around briefly so the trigger burst has time to play
          // client-side, instead of vanishing the instant it deals damage.
          effect.expiresAt = now + 400;
        }
      }

      if (effect.type === 'amaterasu') {
        if (now >= effect.nextTick) {
          effect.nextTick = now + effect.tickInterval;
          const target = this.room.server.players.get(effect.targetId);
          if (target && target.isAlive) {
            const dealt = this.room.applyDamage(effect.targetId, effect.damage, effect.ownerId, 'amaterasu');
            const owner = this.room.server.players.get(effect.ownerId);
            if (owner && dealt > 0) {
              this.room.server.send(owner, {
                type: S2C.HIT_CONFIRMED,
                targetId: effect.targetId,
                spellId: 'amaterasu',
                damage: dealt,
                isHeadshot: false,
              });
            }
          } else {
            toRemove.push(id);
          }
        }
      }
    }

    for (const id of toRemove) this.room.effects.delete(id);

    // Tick barriers — remove once expired or broken
    const barrierToRemove = [];
    for (const [id, barrier] of this.room.barriers) {
      if (!barrier.active || now > barrier.expiresAt) barrierToRemove.push(id);
    }
    for (const id of barrierToRemove) this.room.barriers.delete(id);

    // Tick domains
    const domainToRemove = [];
    for (const [id, domain] of this.room.domains) {
      if (now > domain.expiresAt) {
        domainToRemove.push(id);
        this.room.server.broadcast(this.room.id, { type: S2C.DOMAIN_END, domainId: id });
        this._onDomainEnd(domain);
      } else {
        this._tickDomainEffects(domain, now);
      }
    }
    for (const id of domainToRemove) this.room.domains.delete(id);
  }

  /** Passives that trigger when a domain expires: Ice Hypothermia, Earth Tectonic. */
  _onDomainEnd(domain) {
    const owner = this.room.server.players.get(domain.ownerId);
    if (!owner) return;

    if (domain.spellId === 'absolute_zero' && owner.unlockedNodes.has('hypothermia')) {
      for (const pid of this.room.playerIds) {
        if (pid === domain.ownerId) continue;
        const p = this.room.server.players.get(pid);
        if (p?.isAlive) p.applyEffect('slow', 2000, 1, domain.ownerId);
      }
    }

    if (domain.spellId === 'terra_domain' && owner.unlockedNodes.has('tectonic')) {
      owner.bedrock = true;
      owner.bedrockIdleSince = Date.now() - 2000;
    }
  }

  /** Per-domain effects that aren't just a movement/projectile multiplier — currently just Terra Domain's periodic stone spires. */
  _tickDomainEffects(domain, now) {
    if (now < domain.activatesAt) return;
    const config = DOMAIN_CONFIGS[domain.spellId];
    if (config?.effect !== 'stone_spires') return;

    if (!domain.nextSpireAt) domain.nextSpireAt = now;
    if (now < domain.nextSpireAt) return;

    const interval = Math.max(200, (domain.expiresAt - domain.activatesAt) / (config.spireCount ?? 10));
    domain.nextSpireAt = now + interval;

    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * (ARENA_RADIUS - 4);
    this._spawnSpire(domain.ownerId, { x: Math.cos(angle) * dist, y: 0, z: Math.sin(angle) * dist });
  }

  /** Ice Permafrost: ground the caster walks over briefly slows pursuers (owner is immune, same as any aoe owner-skip). */
  _spawnPermafrostTrail(player) {
    const id = uuid();
    this.room.effects.set(id, {
      id,
      type: 'aoe',
      spellId: 'permafrost_trail',
      school: 'ice',
      color: '#a0d8ff',
      glowColor: '#c8f0ff',
      ownerId: player.id,
      position: { x: player.position.x, y: 0, z: player.position.z },
      radius: 1.5,
      damage: 0,
      statusEffect: 'slow',
      statusDuration: 800,
      lifesteal: 0,
      shape: 'point',
      direction: null,
      length: 0,
      windupMs: 0,
      duration: 1,
      startedAt: Date.now(),
      activatesAt: Date.now(),
      expiresAt: Date.now() + 1000,
      triggered: false,
      active: true,
    });
  }

  /** Void Bloom's onImpact: a lingering zone of minor damage + slow at the impact point. */
  _spawnVoidTendrils(position, ownerId) {
    const id = uuid();
    this.room.effects.set(id, {
      id,
      type: 'aoe',
      spellId: 'void_tendrils',
      school: 'dark',
      color: '#4400aa',
      glowColor: '#6600cc',
      ownerId,
      position: { x: position.x, y: 0, z: position.z },
      radius: 3.0,
      damage: 8,
      statusEffect: 'slow',
      statusDuration: 1500,
      windupMs: 0,
      duration: 3,
      startedAt: Date.now(),
      activatesAt: Date.now(),
      expiresAt: Date.now() + 3000,
      triggered: false,
      active: true,
    });
  }

  /** A single Terra Domain stone spire: brief telegraph, then a burst of damage. The owner is immune (see _resolveAoe's owner skip). */
  _spawnSpire(ownerId, position) {
    const id = uuid();
    const telegraphMs = 500;
    this.room.effects.set(id, {
      id,
      type: 'aoe',
      spellId: 'terra_domain_spire',
      school: 'earth',
      color: '#8B6914',
      glowColor: '#6B5010',
      ownerId,
      position,
      radius: 2.0,
      damage: 35,
      statusEffect: 'stun',
      statusDuration: 400,
      windupMs: telegraphMs,
      duration: 0,
      startedAt: Date.now(),
      activatesAt: Date.now() + telegraphMs,
      expiresAt: Date.now() + telegraphMs + 500,
      triggered: false,
      active: true,
    });
  }

  _resolveAoe(effect, now, isLinger = false) {
    let totalDealt = 0;
    const owner = this.room.server.players.get(effect.ownerId);

    for (const pid of this.room.playerIds) {
      if (pid === effect.ownerId && (!isLinger || effect.excludeOwner)) continue;
      const player = this.room.server.players.get(pid);
      if (!player || !player.isAlive) continue;

      if (this._effectContainsPoint(effect, player.position)) {
        const dmg = isLinger ? Math.round(effect.damage * 0.3) : effect.damage;
        const dealt = this.room.applyDamage(pid, dmg, effect.ownerId, effect.spellId);
        totalDealt += dealt;
        if (effect.statusEffect) {
          player.applyEffect(effect.statusEffect, effect.statusDuration, 1, effect.ownerId);
        }
        if (owner && dealt > 0) {
          this.room.server.send(owner, {
            type: S2C.HIT_CONFIRMED,
            targetId: pid,
            spellId: effect.spellId,
            damage: dealt,
            isHeadshot: false,
          });
        }
      }
    }

    // Blood Nova and similar: heal the caster for a share of the total damage dealt.
    if (effect.lifesteal && totalDealt > 0) {
      const owner = this.room.server.players.get(effect.ownerId);
      if (owner) owner.health = Math.min(owner.maxHealth, owner.health + Math.round(totalDealt * effect.lifesteal));
    }
  }

  /** True if `pos` (XZ) falls within an aoe effect's footprint — a circle, or a capsule along `direction*length` for line-shaped effects (Fissure). */
  _effectContainsPoint(effect, pos) {
    if (effect.shape === 'line' && effect.direction && effect.length) {
      const segX = effect.direction.x * effect.length;
      const segZ = effect.direction.z * effect.length;
      const segLenSq = segX * segX + segZ * segZ || 1;
      const dx = pos.x - effect.position.x, dz = pos.z - effect.position.z;
      const t = Math.max(0, Math.min(1, (dx * segX + dz * segZ) / segLenSq));
      const closestX = effect.position.x + segX * t;
      const closestZ = effect.position.z + segZ * t;
      const ddx = pos.x - closestX, ddz = pos.z - closestZ;
      return Math.sqrt(ddx * ddx + ddz * ddz) < effect.radius;
    }

    const dx = pos.x - effect.position.x, dz = pos.z - effect.position.z;
    return Math.sqrt(dx * dx + dz * dz) < effect.radius;
  }

  _resolveBeam(effect, now, dt) {
    const owner = this.room.server.players.get(effect.ownerId);
    if (!owner) return;

    // Beams track the caster's current look direction every tick instead of
    // the aim direction frozen at cast time — previously a beam fired at one
    // spot stayed locked there for its whole duration regardless of where the
    // caster turned. Mutating effect.direction here also updates what's
    // broadcast to clients, so the visual (BeamSpell.tsx) follows along too.
    effect.direction = {
      x: -Math.sin(owner.yaw) * Math.cos(owner.pitch),
      y: Math.sin(owner.pitch),
      z: -Math.cos(owner.yaw) * Math.cos(owner.pitch),
    };

    const spell = getSpell(effect.spellId);
    let blockDist = null;
    if (!spell?.wallPiercing) {
      const terrainBlockDist = terrainRaycastBlocked({ ...owner.position }, effect.direction, 20);
      const barrierBlock = this._barrierRayBlock({ ...owner.position }, effect.direction, 20);
      if (barrierBlock.distance !== null) this._damageBarrier(barrierBlock.barrier, Math.round(effect.damage * dt));
      const candidates = [terrainBlockDist];
      if (barrierBlock.distance !== null && !spell?.destroysBarriers) candidates.push(barrierBlock.distance);
      blockDist = candidates.filter((d) => d !== null).sort((a, b) => a - b)[0] ?? null;
    }

    // Cast ray from owner in beam direction
    for (const pid of this.room.playerIds) {
      if (pid === effect.ownerId) continue;
      const player = this.room.server.players.get(pid);
      if (!player || !player.isAlive) continue;

      // Simple check: is player roughly in beam direction?
      const toPlayer = {
        x: player.position.x - owner.position.x,
        y: 0,
        z: player.position.z - owner.position.z,
      };
      const dist = Math.sqrt(toPlayer.x * toPlayer.x + toPlayer.z * toPlayer.z);
      if (dist > 20) continue;
      if (blockDist !== null && dist > blockDist) continue;

      const dot = (toPlayer.x / dist) * effect.direction.x + (toPlayer.z / dist) * effect.direction.z;
      if (dot < 0.9) continue; // ~26 degree cone

      const tickDmg = Math.round(effect.damage * dt);
      const actual = this.room.applyDamage(pid, tickDmg, effect.ownerId, effect.spellId);

      if (effect.lifesteal && owner) {
        owner.health = Math.min(owner.maxHealth, owner.health + Math.round(actual * effect.lifesteal));
      }
      if (effect.statusEffect) {
        player.applyEffect(effect.statusEffect, effect.statusDuration, 1, effect.ownerId);
      }
    }
  }

  // ── Mobility implementations ─────────────────────────────────────────────

  // Returns normalized XZ direction matching movement keys, or forward if idle.
  _getDashDir(player, input) {
    const yaw = input?.yaw ?? player.yaw; // use current-frame yaw, not the stale tick value
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    let dx = 0, dz = 0;
    const flags = input?.flags ?? 0;
    if (flags & 1)  { dz -= cos; dx -= sin; } // forward
    if (flags & 2)  { dz += cos; dx += sin; } // backward
    if (flags & 4)  { dz += sin; dx -= cos; } // left (strafe)
    if (flags & 8)  { dz -= sin; dx += cos; } // right (strafe)
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) return { x: -sin, z: -cos }; // not moving → dash forward
    return { x: dx / len, z: dz / len };
  }

  _magmaDash(player, spell, input) {
    const dashDist = 6;
    const dir = this._getDashDir(player, input);
    player.position.x += dir.x * dashDist;
    player.position.z += dir.z * dashDist;

    // Leave burn trail as AoE — excludeOwner so the caster doesn't repeatedly
    // burn themselves for standing in the middle of their own landing spot
    // (see _resolveAoe's isLinger handling).
    const trailId = uuid();
    this.room.effects.set(trailId, {
      id: trailId,
      type: 'aoe',
      spellId: 'magma_dash_trail',
      school: 'fire',
      color: '#ff4500',
      glowColor: '#ff6b2b',
      ownerId: player.id,
      position: { ...player.position },
      radius: 2,
      damage: spell.damage,
      statusEffect: 'burn',
      statusDuration: 1500,
      windupMs: 0,
      duration: 2,
      startedAt: Date.now(),
      activatesAt: Date.now(),
      expiresAt: Date.now() + 2000,
      triggered: false,
      excludeOwner: true,
      active: true,
    });
  }

  _glacierStep(player, spell, input) {
    const dist = player.unlockedNodes.has('cryogenic') ? 10 : 8;
    const dir = this._getDashDir(player, input);
    player.position.x += dir.x * dist;
    player.position.z += dir.z * dist;

    // Frost landing zone — excludeOwner so dashing here doesn't immediately
    // re-slow the caster standing in the middle of it (see _resolveAoe).
    const frostId = uuid();
    this.room.effects.set(frostId, {
      id: frostId,
      type: 'aoe',
      spellId: 'glacier_step_frost',
      school: 'ice',
      color: '#a0d8ff',
      glowColor: '#c8f0ff',
      ownerId: player.id,
      position: { ...player.position },
      radius: player.unlockedNodes.has('cryogenic') ? 4 : 3,
      damage: 0,
      statusEffect: 'slow',
      statusDuration: 1500,
      windupMs: 0,
      duration: 4,
      startedAt: Date.now(),
      activatesAt: Date.now(),
      expiresAt: Date.now() + 4000,
      triggered: false,
      excludeOwner: true,
      active: true,
    });
  }

  _phaseSlip(player, spell, input) {
    const duration = player.unlockedNodes.has('phase_duration_2') ? 3000 : 2000;
    player.isPhasing = true;
    player.phaseExpiry = Date.now() + duration;
    player.applyEffect('phase', duration, 1, player.id);
    // Give a burst of velocity in the movement direction so phase slip feels like a dash
    const dir = this._getDashDir(player, input);
    const burstSpeed = 14;
    player.velocity.x = dir.x * burstSpeed;
    player.velocity.z = dir.z * burstSpeed;
  }

  _swordLunge(player, spell, input) {
    const dist = 7;
    const dir = this._getDashDir(player, input);
    const startPos = { ...player.position };
    player.position.x += dir.x * dist;
    player.position.z += dir.z * dist;

    // Check for enemies along lunge path
    for (const pid of this.room.playerIds) {
      if (pid === player.id) continue;
      const other = this.room.server.players.get(pid);
      if (!other || !other.isAlive) continue;
      const dx = other.position.x - startPos.x;
      const dz = other.position.z - startPos.z;
      if (Math.sqrt(dx * dx + dz * dz) < dist + 1.5) {
        this.room.applyDamage(pid, spell.damage, player.id, 'lunge');
      }
    }
  }

  _stoneLaunch(player, spell) {
    player.velocity.y = spell.launchForce ?? 20;
    player.isGrounded = false;

    // Slam damage nearby
    const slamId = uuid();
    this.room.effects.set(slamId, {
      id: slamId,
      type: 'aoe',
      spellId: 'stone_launch_slam',
      school: 'earth',
      color: '#8B6914',
      glowColor: '#a08030',
      ownerId: player.id,
      position: { ...player.position },
      radius: 3,
      damage: spell.damage,
      statusEffect: null,
      statusDuration: 0,
      windupMs: 0,
      duration: 0,
      startedAt: Date.now(),
      activatesAt: Date.now(),
      expiresAt: Date.now() + 500,
      triggered: false,
      active: true,
    });

    // Earth The Deep: Stone Launch auto-triggers a small Fissure in the direction the player is facing
    if (player.unlockedNodes.has('the_deep')) {
      const dir = { x: -Math.sin(player.yaw), z: -Math.cos(player.yaw) };
      const fissureId = uuid();
      this.room.effects.set(fissureId, {
        id: fissureId,
        type: 'aoe',
        spellId: 'the_deep_fissure',
        school: 'earth',
        color: '#6B5010',
        glowColor: '#8B6914',
        ownerId: player.id,
        position: { x: player.position.x, y: 0, z: player.position.z },
        radius: 1.0,
        damage: 25,
        statusEffect: 'airborne',
        statusDuration: 800,
        lifesteal: 0,
        shape: 'line',
        direction: dir,
        length: 6,
        windupMs: 0,
        duration: 0,
        startedAt: Date.now(),
        activatesAt: Date.now(),
        expiresAt: Date.now() + 400,
        triggered: false,
        active: true,
      });
    }
  }

  /** Purely visual one-shot burst (currently just Phoenix's fatal-blow proc) — type 'aoe' with 0 damage so it actually renders via AoeSpell.tsx instead of an effect.type nothing in SpellRenderer knows how to draw. */
  triggerEffect(effectType, position, ownerId) {
    const id = uuid();
    const now = Date.now();
    this.room.effects.set(id, {
      id,
      type: 'aoe',
      spellId: effectType,
      school: 'fire',
      color: '#ff8800',
      glowColor: '#ffcc00',
      ownerId,
      position: { x: position.x, y: 0, z: position.z },
      radius: 3,
      damage: 0,
      statusEffect: null,
      shape: 'point',
      windupMs: 0,
      duration: 0,
      startedAt: now,
      activatesAt: now,
      expiresAt: now + 800,
      triggered: false,
      active: true,
    });
  }

  _explodeAtPosition(proj) {
    if (proj.radius <= 0.8) return;
    this._resolveAoe({
      ownerId: proj.ownerId,
      spellId: proj.spellId,
      position: proj.position,
      radius: proj.radius,
      damage: Math.round(proj.damage * 0.5),
      statusEffect: proj.statusEffect,
      statusDuration: proj.statusDuration,
    }, Date.now());
  }

  _projectileHitsBarrier(proj, barrier) {
    const dx = proj.position.x - barrier.position.x;
    const dz = proj.position.z - barrier.position.z;
    return Math.sqrt(dx * dx + dz * dz) < barrier.width / 2 + proj.radius &&
      Math.abs(proj.position.y - barrier.position.y) < barrier.height / 2;
  }

  _deny(player, spellId, reason, extra) {
    this.room.server.send(player, {
      type: S2C.SPELL_CAST_DENIED,
      spellId,
      reason,
      ...(extra ? { cooldownRemaining: extra } : {}),
    });
  }
}
