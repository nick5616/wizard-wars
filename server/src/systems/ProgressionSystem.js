import { v4 as uuid } from 'uuid';
import { S2C } from 'shared/events';
import { hatBuffTierForLevel, HAT_BUFF_DAMAGE_MULT, HAT_BUFF_DURATION_MS, maxManaFor } from 'shared/leveling';
import { SKILL_TREES, getNode, canUnlockNode, getForkPair } from 'shared/skillTrees';
import { DEFAULT_EQUIPPED, MAX_SPELL_SLOTS, MOBILITY_SPELL, DEFENSIVE_SPELL } from 'shared/spells';
import { CLASS_FORK_GROUP } from 'shared/classFlavor';

// The one designated fork per class (branchGroup) is a permanent,
// once-per-life commitment -- that gets the full dramatic despawn treatment
// (see _openChoice) and, for a human, no timeout at all: the client shows no
// countdown (SkillVotePrompt.tsx) so they can actually read it. This is only
// a safety net for someone who walks away mid-vote.
const HUMAN_FORK_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Skill-tree auto-unlock and the F1..Fn point-spend prompt, plus the
 * wizard-hat contact buff. Kept separate from SpellSystem/Room since it's
 * about progression state, not combat resolution.
 */
export class ProgressionSystem {
  constructor(room) {
    this.room = room;
    this.pendingVotes = new Map(); // playerId -> { id, branchGroup, options: [nodeId...], expiresAt, blocking }
  }

  // ── Auto-unlock ───────────────────────────────────────────────────────────
  // Skill points spend themselves the instant they're available -- no manual
  // "buy" clicking -- EXCEPT when there's more than one legal node to spend
  // the point on. A single unambiguous next step (the overwhelmingly common
  // case) unlocks immediately and silently. A genuine choice pauses and asks:
  //   - an undecided fork pair (mutually exclusive, permanent) gets the full
  //     fullscreen despawn treatment (_openChoice(..., blocking: true))
  //   - anything else (e.g. several ordinary spells becoming available at
  //     the same tier at once) gets a light, non-blocking prompt that just
  //     sits there until answered -- it never interrupts play, and a player
  //     who ignores it simply keeps their point banked instead of it being
  //     silently spent for them.
  // Bots never see either prompt -- they can't answer one, so they always
  // auto-pick the first candidate (and, for a fork, that IS their permanent
  // branch commitment) and keep walking.
  tryAutoUnlock(player) {
    if (!player.class || this.pendingVotes.has(player.id)) return;

    const sorted = [...(SKILL_TREES[player.class] ?? [])].sort((a, b) => a.tier - b.tier);

    while (player.skillPoints > 0) {
      const candidates = sorted.filter((node) => {
        if (!canUnlockNode(node, player.unlockedNodes)) return false;
        const decided = node.branchGroup && player.divergedBranch[node.branchGroup];
        return !decided || node.branch === decided;
      });

      if (candidates.length === 0) return; // nothing left to spend on right now

      if (candidates.length === 1 || player.isBot) {
        const pick = candidates[0];
        if (pick.branchGroup && !player.divergedBranch[pick.branchGroup]) {
          player.divergedBranch[pick.branchGroup] = pick.branch;
        }
        this._unlockNode(player, pick);
        continue; // re-evaluate candidates for the next point, if any
      }

      const forkNode = candidates.find((n) => n.branchGroup && !player.divergedBranch[n.branchGroup]);
      if (forkNode) {
        const pair = getForkPair(player.class, forkNode.branchGroup);
        this._openChoice(player, forkNode.branchGroup, pair, true);
      } else {
        this._openChoice(player, null, candidates, false);
      }
      return; // pause until the player answers
    }
  }

  /**
   * Debug mode: unlock the entire tree right now, including BOTH sides of
   * the class's one fork -- a normal playthrough (and the old version of
   * this method, which just auto-picked one fork option via the vote path)
   * only ever grants one branch, since divergedBranch is meant to be a
   * permanent commitment. That's correct for real play but is exactly why
   * debug mode kept showing "missing paths": half the tree is unreachable
   * by design once you've committed. Debug mode is for testing everything
   * at once, so it bypasses that exclusivity entirely and force-unlocks
   * every node in tier order, ignoring prereqs and branchGroup gating.
   */
  forceUnlockAll(player) {
    if (!player.class) return;
    this.pendingVotes.delete(player.id);

    const sorted = [...(SKILL_TREES[player.class] ?? [])].sort((a, b) => a.tier - b.tier);
    for (const node of sorted) {
      if (player.unlockedNodes.has(node.id)) continue;
      // Cosmetic only in debug mode -- lets whichever branch unlocks last
      // "win" for symbol/title purposes, but both sides' spells are unlocked
      // and equippable regardless of what divergedBranch ends up holding.
      if (node.branchGroup) player.divergedBranch[node.branchGroup] = node.branch;
      this._unlockNode(player, node);
    }
  }

  /**
   * candidates.length is always >= 2 here (see tryAutoUnlock). blocking=true
   * is exclusively the once-per-life fork: pulls the player out of the fight
   * entirely while they decide -- hidden (RemotePlayer.tsx), invulnerable
   * (Room.applyDamage), and input-frozen (Room.processInput) -- and never
   * expires for a human (HUMAN_FORK_TIMEOUT_MS is just a walk-away safety
   * net). blocking=false is an ordinary "you have a point to spend, and more
   * than one place it could go" prompt: no despawn, no timeout at all, keeps
   * playing normally, and updates in place if more points arrive before it's
   * answered.
   */
  _openChoice(player, branchGroup, candidates, blocking) {
    const id = uuid();
    const expiresAt = blocking ? Date.now() + HUMAN_FORK_TIMEOUT_MS : Infinity;
    this.pendingVotes.set(player.id, { id, branchGroup, options: candidates.map((n) => n.id), expiresAt, blocking });
    if (blocking) player.isChoosingBranch = true;

    this.room.server.send(player, {
      type: S2C.SKILL_VOTE_PROMPT,
      promptId: id,
      branchGroup,
      blocking,
      options: candidates.map((n) => ({ id: n.id, label: n.label, description: n.description })),
    });
  }

  resolveVote(player, promptId, choice) {
    const pending = this.pendingVotes.get(player.id);
    if (!pending || pending.id !== promptId) return;
    this.pendingVotes.delete(player.id);
    if (pending.blocking) player.isChoosingBranch = false;

    const nodeId = pending.options.includes(choice) ? choice : pending.options[0];
    const node = getNode(player.class, nodeId);
    if (!node) return;

    if (node.branchGroup) player.divergedBranch[node.branchGroup] = node.branch;
    this._unlockNode(player, node);
    this.tryAutoUnlock(player); // resume -- may immediately open another prompt if more points/candidates remain
  }

  /** Called every server tick from Room.update() -- auto-resolves a fork nobody answered in time (a walk-away safety net; ordinary point-spend prompts never expire). */
  tickVotes(now) {
    for (const [playerId, pending] of this.pendingVotes) {
      if (now < pending.expiresAt) continue;
      const player = this.room.server.players.get(playerId);
      this.pendingVotes.delete(playerId);
      if (player) this.resolveVote(player, pending.id, pending.options[0]);
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

  /**
   * Debug mode: live-swap to ANY subclass of ANY class without dying or
   * respawning -- no room.spawnPlayer, position/HP/room untouched, so bots
   * keep fighting and the Experiment Lab session just keeps going. Crossing
   * classes force-unlocks the new class's whole tree on the spot (debug
   * mode's usual "everything unlocked" guarantee, just applied lazily as
   * you visit each class) instead of requiring a trip through DEBUG_GRANT
   * again. Either way this re-stamps divergedBranch (symbol/title flavor)
   * and re-equips the loadout to the chosen branch's actual spell chain so
   * the switch is felt, not just cosmetic.
   */
  setDebugSubclass(player, wizardClass, branch) {
    if (!player.isDebugMode) return;
    const branchGroup = CLASS_FORK_GROUP[wizardClass];
    const pair = getForkPair(wizardClass, branchGroup);
    const target = pair?.find((n) => n.branch === branch);
    if (!target) return;

    if (player.class !== wizardClass) {
      player.class = wizardClass;
      player.mobilitySpell = MOBILITY_SPELL[wizardClass];
      player.defensiveSpell = DEFENSIVE_SPELL[wizardClass];
      player.maxMana = maxManaFor(wizardClass, player.level);
      player.mana = player.maxMana;
      this.forceUnlockAll(player);
    }

    player.divergedBranch = { [branchGroup]: branch };

    const tree = SKILL_TREES[wizardClass] ?? [];
    const chain = [target];
    let current = target;
    for (;;) {
      const next = tree.find((n) => n.prereqs.length === 1 && n.prereqs[0] === current.id);
      if (!next) break;
      chain.push(next);
      current = next;
    }

    const trunk = tree.filter((n) => n.tier < target.tier && n.type === 'spell').map((n) => n.id);
    const branchSpells = chain.filter((n) => n.type === 'spell').map((n) => n.id);
    const loadout = [...trunk, ...branchSpells];
    player.equippedSpells = Array.from({ length: MAX_SPELL_SLOTS }, (_, i) => loadout[i] ?? null);
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
