import { v4 as uuid } from 'uuid';
import { getSpell, MOBILITY_SPELL, BASIC_ATTACK, MELEE_ATTACK } from 'shared/spells';
import { S2C } from 'shared/events';
import { DOMAIN_CONFIGS } from 'shared/gameConfig';
import { MAX_CONCURRENT_DOMAINS, ARENA_RADIUS, PLAYER_HEIGHT } from 'shared/constants';
import { hatCenterY, hatRadius } from 'shared/leveling';

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

    // Check alive and class match
    if (!player.isAlive) return this._deny(player, spellId, 'not_alive');
    if (spell.class !== player.class) return this._deny(player, spellId, 'wrong_class');

    // Check cooldown
    if (player.isOnCooldown(spellId)) {
      return this._deny(player, spellId, 'on_cooldown', player.getCooldownRemaining(spellId));
    }

    // Domain: only one active at a time globally
    if (spell.type === 'domain' && this.room.getActiveDomain()) {
      return this._deny(player, spellId, 'domain_active');
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

    // Set cooldown
    player.setCooldown(spellId, spell.cooldown);

    // Dispatch cast by type
    switch (spell.type) {
      case 'projectile': this._castProjectile(player, spell, aimDir, clientTimestamp); break;
      case 'beam':       this._castBeam(player, spell, aimDir, clientTimestamp); break;
      case 'hitscan':    this._castHitscan(player, spell, aimDir, clientTimestamp); break;
      case 'aoe':        this._castAoe(player, spell, aimDir, clientTimestamp); break;
      case 'domain':     this._castDomain(player, spell); break;
      case 'direct':     this._castDirect(player, spell, targetId, clientTimestamp); break;
      default: break;
    }

    // Notify caster of confirmed cast
    this.room.server.send(player, {
      type: S2C.SPELL_CAST,
      spellId,
      slotIndex,
      cooldownMs: spell.cooldown * 1000,
    });

    // Sword phantom blade: mirror next casts
    if (player.phantomCasts > 0 && spell.type !== 'domain') {
      player.phantomCasts--;
      // Re-cast same spell as phantom (no cooldown)
      this._castProjectile(player, spell, aimDir, clientTimestamp, true);
    }
  }

  handleMobility(player, input) {
    const spellId = MOBILITY_SPELL[player.class];
    if (!spellId) return;

    const spell = getSpell(spellId);
    if (!spell || player.isOnCooldown(spellId)) return;

    player.setCooldown(spellId, spell.cooldown);

    switch (player.class) {
      case 'fire':  this._magmaDash(player, spell, input); break;
      case 'ice':   this._glacierStep(player, spell, input); break;
      case 'dark':  this._phaseSlip(player, spell, input); break;
      case 'sword': this._swordLunge(player, spell, input); break;
      case 'earth': this._stoneLaunch(player, spell); break;
    }
  }

  // ── Basic attack (RMB) & melee (F) ──────────────────────────────────────
  // Universal per-class abilities outside the 4 equip slots -- always
  // available from spawn, no unlock needed. Same "outside the slot system"
  // treatment as handleMobility above.

  handleBasicAttack(player, aimDir, clientTimestamp) {
    const spellId = BASIC_ATTACK[player.class];
    if (!spellId || !player.isAlive) return;
    const spell = getSpell(spellId);
    if (!spell || player.isOnCooldown(spellId)) return;

    player.setCooldown(spellId, spell.cooldown);
    this._castHitscan(player, spell, aimDir, clientTimestamp);
  }

  handleMelee(player, aimDir, clientTimestamp) {
    const spellId = MELEE_ATTACK[player.class];
    if (!spellId || !player.isAlive) return;
    const spell = getSpell(spellId);
    if (!spell || player.isOnCooldown(spellId)) return;

    player.setCooldown(spellId, spell.cooldown);

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

  _castHitscan(player, spell, aimDir, clientTimestamp) {
    // Determine compensation timestamp
    const compTimestamp = clientTimestamp - (player.rtt / 2);

    const result = this.room.lagCompensation.rayCast(
      { ...player.position }, // position.y is eye level
      aimDir,
      spell.radius ?? 0.5,
      player.id,
      compTimestamp,
    );

    // Broadcast visual (everyone sees the beam regardless)
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
    });

    if (result.hit) {
      const dmgMult = result.isHeadshot ? 1.5 : 0.85;
      const dmg = this.room.applyDamage(result.playerId, Math.round(spell.damage * dmgMult), player.id, spell.id);
      const target = this.room.server.players.get(result.playerId);
      if (target && spell.statusEffect) {
        target.applyEffect(spell.statusEffect, spell.statusDuration);
      }
      if (result.isHatHit) this.room.progressionSystem.applyHatBuff(player.id, result.targetLevel);

      this.room.server.send(player, {
        type: S2C.HIT_CONFIRMED,
        targetId: result.playerId,
        spellId: spell.id,
        damage: dmg,
        isHeadshot: result.isHeadshot,
      });
    }
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
    const effectId = uuid();
    // Cast at aim target (raycast from player)
    const targetPos = {
      x: player.position.x + aimDir.x * 12,
      y: 0,
      z: player.position.z + aimDir.z * 12,
    };

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
      windupMs: spell.windupMs ?? 0,
      duration: spell.duration ?? 0,
      startedAt: Date.now(),
      activatesAt: Date.now() + (spell.windupMs ?? 0),
      expiresAt: Date.now() + (spell.windupMs ?? 0) + ((spell.duration ?? 0.5) * 1000),
      triggered: false,
      active: true,
    };

    this.room.effects.set(effectId, effect);
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
      expiresAt: now + (config?.duration ?? 4) * 1000,
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
    const target = this.room.server.players.get(targetId);
    if (!target || !target.isAlive) return;

    if (spell.id === 'death_note') {
      // Windup is already handled; deal damage immediately (server already validated)
      this.room.applyDamage(targetId, spell.damage, player.id, spell.id);
      return;
    }

    if (spell.id === 'shatter') {
      target.removeEffect('freeze');
      this.room.applyDamage(targetId, spell.damage, player.id, spell.id);
      return;
    }

    if (spell.id === 'petrify') {
      target.applyEffect('petrify', spell.statusDuration);
      return;
    }

    // Phantom blade: set up mirroring
    if (spell.id === 'phantom_blade') {
      player.phantomCasts = player.unlockedNodes.has('razors_edge') ? 3 : 2;
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

    // Generic direct damage
    const dmg = this.room.applyDamage(targetId, spell.damage, player.id, spell.id);
    if (spell.statusEffect) target.applyEffect(spell.statusEffect, spell.statusDuration);
  }

  // ── Tick projectiles ──────────────────────────────────────────────────────

  tickProjectiles(dt, now) {
    const toRemove = [];

    for (const [id, proj] of this.room.projectiles) {
      if (!proj.active || now > proj.expiresAt) {
        toRemove.push(id);
        continue;
      }

      // Move projectile
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

      // Barrier collision
      let hitBarrier = false;
      for (const [, barrier] of this.room.barriers) {
        if (barrier.active && this._projectileHitsBarrier(proj, barrier)) {
          const spell = getSpell(proj.spellId);
          if (!spell?.destroysBarriers) {
            toRemove.push(id);
            hitBarrier = true;
          } else {
            barrier.health -= proj.damage;
            if (barrier.health <= 0) barrier.active = false;
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

        const dmgMult = isHeadshot ? 1.5 : 0.85;
        const dmg = this.room.applyDamage(playerId, Math.round(proj.damage * dmgMult), proj.ownerId, proj.spellId);
        if (proj.statusEffect && target) {
          target.applyEffect(proj.statusEffect, proj.statusDuration);
        }
        if (isHatHit) this.room.progressionSystem.applyHatBuff(proj.ownerId, targetLevel);

        // Lifesteal
        const owner = this.room.server.players.get(proj.ownerId);
        if (owner) {
          const spell = getSpell(proj.spellId);
          if (spell?.lifesteal) {
            owner.health = Math.min(owner.maxHealth, owner.health + Math.round(dmg * spell.lifesteal));
          }
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

      if (effect.type === 'amaterasu') {
        if (now >= effect.nextTick) {
          effect.nextTick = now + effect.tickInterval;
          const target = this.room.server.players.get(effect.targetId);
          if (target && target.isAlive) {
            this.room.applyDamage(effect.targetId, effect.damage, effect.ownerId, 'amaterasu');
          } else {
            toRemove.push(id);
          }
        }
      }
    }

    for (const id of toRemove) this.room.effects.delete(id);

    // Tick domains
    const domainToRemove = [];
    for (const [id, domain] of this.room.domains) {
      if (now > domain.expiresAt) {
        domainToRemove.push(id);
        this.room.server.broadcast(this.room.id, { type: S2C.DOMAIN_END, domainId: id });
      }
    }
    for (const id of domainToRemove) this.room.domains.delete(id);
  }

  _resolveAoe(effect, now, isLinger = false) {
    for (const pid of this.room.playerIds) {
      if (pid === effect.ownerId && !isLinger) continue;
      const player = this.room.server.players.get(pid);
      if (!player || !player.isAlive) continue;

      const dx = player.position.x - effect.position.x;
      const dz = player.position.z - effect.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < effect.radius) {
        const dmg = isLinger ? Math.round(effect.damage * 0.3) : effect.damage;
        this.room.applyDamage(pid, dmg, effect.ownerId, effect.spellId);
        if (effect.statusEffect) {
          player.applyEffect(effect.statusEffect, effect.statusDuration);
        }
      }
    }
  }

  _resolveBeam(effect, now, dt) {
    const owner = this.room.server.players.get(effect.ownerId);
    if (!owner) return;

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

      const dot = (toPlayer.x / dist) * effect.direction.x + (toPlayer.z / dist) * effect.direction.z;
      if (dot < 0.9) continue; // ~26 degree cone

      const tickDmg = Math.round(effect.damage * dt);
      const actual = this.room.applyDamage(pid, tickDmg, effect.ownerId, effect.spellId);

      if (effect.lifesteal && owner) {
        owner.health = Math.min(owner.maxHealth, owner.health + Math.round(actual * effect.lifesteal));
      }
      if (effect.statusEffect) {
        player.applyEffect(effect.statusEffect, effect.statusDuration);
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

    // Leave burn trail as AoE
    const trailId = uuid();
    this.room.effects.set(trailId, {
      id: trailId,
      type: 'aoe',
      spellId: 'magma_dash_trail',
      ownerId: player.id,
      position: { ...player.position },
      radius: 2,
      damage: 15,
      statusEffect: 'burn',
      statusDuration: 1500,
      windupMs: 0,
      duration: 2,
      startedAt: Date.now(),
      activatesAt: Date.now(),
      expiresAt: Date.now() + 2000,
      triggered: false,
      active: true,
    });
  }

  _glacierStep(player, spell, input) {
    const dist = player.unlockedNodes.has('cryogenic') ? 10 : 8;
    const dir = this._getDashDir(player, input);
    player.position.x += dir.x * dist;
    player.position.z += dir.z * dist;

    // Frost landing zone
    const frostId = uuid();
    this.room.effects.set(frostId, {
      id: frostId,
      type: 'aoe',
      spellId: 'glacier_step_frost',
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
      active: true,
    });
  }

  _phaseSlip(player, spell, input) {
    const duration = player.unlockedNodes.has('phase_duration_2') ? 3000 : 2000;
    player.isPhasing = true;
    player.phaseExpiry = Date.now() + duration;
    player.applyEffect('phase', duration);
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
      ownerId: player.id,
      position: { ...player.position },
      radius: 3,
      damage: 20,
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
  }

  triggerEffect(effectType, position, ownerId) {
    const id = uuid();
    this.room.effects.set(id, {
      id,
      type: effectType,
      ownerId,
      position,
      radius: 3,
      damage: 0,
      startedAt: Date.now(),
      expiresAt: Date.now() + 800,
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
