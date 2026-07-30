import { S2C } from 'shared/events';
import { hatBuffTierForLevel, HAT_BUFF_DAMAGE_MULT, HAT_BUFF_DURATION_MS } from 'shared/leveling';
import { SKILL_TREES, getNode, canUnlockNode, getForkPair } from 'shared/skillTrees';
import { DEFAULT_EQUIPPED } from 'shared/spells';

const VOTE_TIMEOUT_MS = 12000;

/**
 * Skill-tree auto-unlock, the F1/F2 divergence vote, and the wizard-hat
 * contact buff. Kept separate from SpellSystem/Room since it's about
 * progression state, not combat resolution.
 */
export class ProgressionSystem {
  constructor(room) {
    this.room = room;
    this.pendingVotes = new Map(); // playerId -> { branchGroup, options: [nodeIdA, nodeIdB], expiresAt }
  }

  // ── Auto-unlock ───────────────────────────────────────────────────────────
  // Skill points spend themselves the instant they're available -- no more
  // manual "buy" clicking. Call this whenever skillPoints increases (on kill,
  // on class select, after a vote resolves). Walks the class tree in tier
  // order, unlocking anything whose prereqs are satisfied, until it either
  // runs out of points, runs out of unlockable nodes, or hits the one
  // designated fork for the class -- at which point it opens a vote and
  // pauses until the player (or the timeout) resolves it.
  tryAutoUnlock(player) {
    if (!player.class || this.pendingVotes.has(player.id)) return;

    const sorted = [...(SKILL_TREES[player.class] ?? [])].sort((a, b) => a.tier - b.tier);

    let changed = true;
    while (changed && player.skillPoints > 0) {
      changed = false;

      for (const node of sorted) {
        if (!canUnlockNode(node, player.unlockedNodes)) continue;

        if (node.branchGroup) {
          const decided = player.divergedBranch[node.branchGroup];
          if (decided) {
            if (node.branch !== decided) continue; // this class committed to the other branch
          } else {
            const pair = getForkPair(player.class, node.branchGroup);
            if (pair && pair.every((n) => !player.unlockedNodes.has(n.id))) {
              this._openVote(player, node.branchGroup, pair);
              return; // pause everything until the vote resolves
            }
          }
        }

        this._unlockNode(player, node);
        changed = true;
        if (player.skillPoints <= 0) break;
      }
    }
  }

  _openVote(player, branchGroup, pair) {
    const expiresAt = Date.now() + VOTE_TIMEOUT_MS;
    this.pendingVotes.set(player.id, { branchGroup, options: pair.map((n) => n.id), expiresAt });
    this.room.server.send(player, {
      type: S2C.SKILL_VOTE_PROMPT,
      branchGroup,
      options: pair.map((n) => ({ id: n.id, label: n.label, description: n.description })),
      timeoutMs: VOTE_TIMEOUT_MS,
    });
  }

  resolveVote(player, branchGroup, choice) {
    const pending = this.pendingVotes.get(player.id);
    if (!pending || pending.branchGroup !== branchGroup) return;
    this.pendingVotes.delete(player.id);

    const nodeId = pending.options.includes(choice) ? choice : pending.options[0];
    const node = getNode(player.class, nodeId);
    if (!node) return;

    player.divergedBranch[node.branchGroup] = node.branch;
    this._unlockNode(player, node);
    this.tryAutoUnlock(player); // resume walking down the chosen branch
  }

  /** Called every server tick from Room.update() -- auto-resolves votes nobody answered in time. */
  tickVotes(now) {
    for (const [playerId, pending] of this.pendingVotes) {
      if (now < pending.expiresAt) continue;
      const player = this.room.server.players.get(playerId);
      this.pendingVotes.delete(playerId);
      if (player) this.resolveVote(player, pending.branchGroup, pending.options[0]);
    }
  }

  _unlockNode(player, node) {
    player.unlockedNodes.add(node.id);
    player.skillPoints--;

    const equip = node.type === 'spell' ? this._autoEquip(player, node) : null;

    this.room.server.send(player, {
      type: S2C.SKILL_AUTO_UNLOCKED,
      nodeId: node.id,
      label: node.label,
      nodeType: node.type,
      skillPoints: player.skillPoints,
      equip,
    });
  }

  /**
   * "Try the other path instead" from the death screen. Resets the player's
   * current class back to its default loadout and commits the fork decision
   * to whichever branch they didn't take last time, so tryAutoUnlock walks
   * straight down it without re-prompting a vote.
   */
  switchBranch(player) {
    if (!player.class) return;
    const decidedGroup = Object.keys(player.divergedBranch)[0];
    if (!decidedGroup) return; // never actually diverged -- nothing to switch from

    const pair = getForkPair(player.class, decidedGroup);
    if (!pair) return;
    const other = pair.find((n) => n.branch !== player.divergedBranch[decidedGroup]);
    if (!other) return;

    const defaults = DEFAULT_EQUIPPED[player.class].filter(Boolean);
    player.unlockedNodes = new Set(defaults);
    player.equippedSpells = [...DEFAULT_EQUIPPED[player.class]];
    player.divergedBranch = { [decidedGroup]: other.branch };
  }

  // ── Auto-equip ───────────────────────────────────────────────────────────
  // 1. empty slot wins. 2. explicit shouldReplace override, if that spell is
  // currently equipped. 3. fallback: replace whichever equipped spell (of the
  // same class) has the lowest tier -- the oldest/weakest tool in the loadout.
  _autoEquip(player, node) {
    const spellId = node.id;
    const slots = player.equippedSpells;

    const emptyIdx = slots.findIndex((s) => s === null);
    if (emptyIdx !== -1) {
      slots[emptyIdx] = spellId;
      return { slotIndex: emptyIdx, replacedSpellId: null };
    }

    if (node.shouldReplace) {
      const idx = slots.indexOf(node.shouldReplace);
      if (idx !== -1) {
        const replaced = slots[idx];
        slots[idx] = spellId;
        return { slotIndex: idx, replacedSpellId: replaced };
      }
    }

    let lowestIdx = -1;
    let lowestTier = Infinity;
    for (let i = 0; i < slots.length; i++) {
      const equippedId = slots[i];
      if (!equippedId) continue;
      const tier = getNode(player.class, equippedId)?.tier ?? 0;
      if (tier < lowestTier) { lowestTier = tier; lowestIdx = i; }
    }
    if (lowestIdx === -1) return null;

    const replaced = slots[lowestIdx];
    slots[lowestIdx] = spellId;
    return { slotIndex: lowestIdx, replacedSpellId: replaced };
  }

  /** Called when a precision hit (projectile/hitscan/melee/basic-attack) lands in the target's hat volume. */
  applyHatBuff(attackerId, targetLevel) {
    const attacker = this.room.server.players.get(attackerId);
    if (!attacker) return;

    const tier = hatBuffTierForLevel(targetLevel);
    const duration = HAT_BUFF_DURATION_MS[tier];
    // Overwrite rather than stack via Player.applyEffect -- stacks here encodes
    // buff tier (driven by the target's hat size), not a repeat-hit counter.
    attacker.activeEffects.set('hat_buff', { expiresAt: Date.now() + duration, stacks: tier });

    this.room.server.send(attacker, {
      type: S2C.HAT_BUFF_PROC,
      tier,
      damageMult: HAT_BUFF_DAMAGE_MULT[tier],
      durationMs: duration,
    });
  }
}
