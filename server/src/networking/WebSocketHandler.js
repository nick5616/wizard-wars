import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuid } from 'uuid';
import { C2S, S2C } from 'shared/events';
import { getNode, canUnlockNode } from 'shared/skillTrees';
import { CLASSES } from 'shared/constants';
import { MAX_SPELL_SLOTS, ALL_SPELLS } from 'shared/spells';
import { GAME_MODES } from 'shared/gameModes';

// Design Lab writes here. Fixed path, never derived from the message — the
// client only ever sends the contents, never a destination.
const CARD_BANK_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../client/src/data/cardRecipeBank.json',
);

export class WebSocketHandler {
  constructor(server) {
    this.server = server;
    this.clockSync = new ClockSyncHandler(server);
  }

  handle(player, msg) {
    switch (msg.type) {
      case C2S.CLOCK_SYNC:     this.clockSync.handle(player, msg); break;
      case C2S.JOIN_ROOM:      this._handleJoinRoom(player, msg); break;
      case C2S.SELECT_CLASS:   this._handleSelectClass(player, msg); break;
      case C2S.PLAYER_INPUT:   this._handleInput(player, msg); break;
      case C2S.EQUIP_SPELL:    this._handleEquipSpell(player, msg); break;
      case C2S.BUY_SKILL_NODE: this._handleBuyNode(player, msg); break;
      case C2S.REVEAL_LORE:    this._handleRevealLore(player, msg); break;
      case C2S.RESPAWN:        this._handleRespawn(player, msg); break;
      case C2S.SKILL_VOTE_RESOLVE: this._handleVoteResolve(player, msg); break;
      case C2S.DEBUG_GRANT:    this._handleDebugGrant(player); break;
      case C2S.DEBUG_SET_BRANCH: this._handleDebugSetBranch(player, msg); break;
      case C2S.SPAWN_BOTS:     this._handleSpawnBots(player, msg); break;
      case C2S.DESPAWN_BOTS:   this._handleDespawnBots(player, msg); break;
      case C2S.START_MATCH:    this._handleStartMatch(player, msg); break;
      case C2S.LEAVE_ROOM:     this._handleLeaveRoom(player, msg); break;
      case C2S.SPAWN_BOT:        this._handleSpawnBot(player, msg); break;
      case C2S.DESPAWN_BOT:      this._handleDespawnBot(player, msg); break;
      case C2S.SET_BOT_BEHAVIOR: this._handleSetBotBehavior(player, msg); break;
      case C2S.SET_BOT_LOADOUT:  this._handleSetBotLoadout(player, msg); break;
      case C2S.SET_BOT_AUTO_EQUIP: this._handleSetBotAutoEquip(player, msg); break;
      case C2S.RUN_SIMULATION:   this._handleRunSimulation(player, msg); break;
      case C2S.SAVE_CARD_RECIPES: this._handleSaveCardRecipes(player, msg); break;
      default: break;
    }
  }

  _handleJoinRoom(player, msg) {
    const isExperiment = !!(msg.experiment && player.isLocalConnection);
    const targetRoomId = isExperiment ? `experiment-${player.id}` : (msg.roomId ?? 'lobby');

    // Re-opening the room you're already in (e.g. reopening the Experiment
    // Lab panel after closing it) must be a no-op: leaving-then-rejoining
    // would run cleanupEmptyExperimentRoom on the way out and, since the
    // only players left at that instant are bots, tear the room (and every
    // spawned bot) down before the rejoin below could recreate it.
    if (player.roomId === targetRoomId) {
      if (msg.username) player.username = msg.username.slice(0, 20);
      if (isExperiment) player.isGodMode = true;
      return;
    }

    // Switching rooms (e.g. lobby <-> Experiment Lab) must leave the old one
    // first — Room.addPlayer only ever adds, so without this a player would
    // stay registered (and get simulated) in both rooms at once.
    this._leaveCurrentRoom(player);

    // Experiment Lab: a private per-player sandbox room, gated server-side —
    // the client hides the entry point off-localhost, but this check is what
    // actually matters (see GameServer.onConnection / isLoopbackAddress).
    if (isExperiment) {
      const room = this.server.getOrCreateRoom(targetRoomId, { respawnEnabled: true });
      if (msg.username) player.username = msg.username.slice(0, 20);
      player.isGodMode = true;
      room.addPlayer(player);
      return;
    }

    player.isGodMode = false;
    const room = this.server.getOrCreateRoom(targetRoomId);

    if (msg.username) player.username = msg.username.slice(0, 20);
    room.addPlayer(player);

    // Resumed session (class/progress restored from Redis on connect, see
    // GameServer._restoreAndGreet): drop straight back into the arena
    // instead of the class-select screen. Must NOT call selectClass() here
    // -- that resets equippedSpells/divergedBranch to fresh-pick defaults
    // and would undo exactly what was just restored.
    if (player.class && !player.isAlive) {
      room.spawnPlayer(player);
    }
  }

  _leaveCurrentRoom(player) {
    if (!player.roomId) return;
    const oldRoomId = player.roomId;
    this.server.rooms.get(oldRoomId)?.removePlayer(player.id);
    this.server.cleanupEmptyPrivateRoom(oldRoomId);
    player.roomId = null;
  }

  /**
   * Landing screen "Single Player": spins up a private match room (never
   * shared with other humans), assigns the picked mode's team/bot roster
   * via Room.setupMatch, and drops the player straight into it.
   */
  _handleStartMatch(player, msg) {
    const mode = GAME_MODES[msg?.mode];
    if (!mode || !CLASSES.includes(msg?.class)) return;

    this._leaveCurrentRoom(player);
    const roomId = `match-${uuid()}`;
    const room = this.server.getOrCreateRoom(roomId, { respawnEnabled: false, matchMode: true });

    if (typeof msg.username === 'string' && msg.username.trim()) {
      player.username = msg.username.trim().slice(0, 20);
    }
    room.addPlayer(player);
    player.selectClass(msg.class);
    room.setupMatch(mode, player);
  }

  /** Returns to "no room" (the main menu) without joining the lobby -- see C2S.LEAVE_ROOM. */
  _handleLeaveRoom(player, msg) {
    this._leaveCurrentRoom(player);
  }

  _handleSelectClass(player, msg) {
    const validClasses = ['fire', 'ice', 'dark', 'sword', 'druid', 'crystalmancer'];
    if (!validClasses.includes(msg.class)) return;

    if (typeof msg.username === 'string' && msg.username.trim()) {
      player.username = msg.username.trim().slice(0, 20);
    }
    player.selectClass(msg.class);
    this.server.persistPlayer(player);

    const room = player.roomId ? this.server.rooms.get(player.roomId) : null;
    if (room) {
      room.spawnPlayer(player);
      room.progressionSystem.tryAutoUnlock(player);
    }
  }

  _handleInput(player, msg) {
    if (!player.roomId) return;
    const room = this.server.rooms.get(player.roomId);
    if (!room) return;

    // Validate sequence
    if (msg.seq <= player.lastAckedSeq) return;
    player.lastAckedSeq = msg.seq;

    room.processInput(player, {
      seq: msg.seq,
      clientTimestamp: msg.ts,
      flags: msg.flags ?? 0,
      yaw: msg.yaw ?? player.yaw,
      pitch: msg.pitch ?? player.pitch,
      cast: msg.cast ?? null,
      mobility: msg.mobility ?? false,
      defensive: msg.defensive ?? false,
      basicAttack: msg.basicAttack ?? null,
      melee: msg.melee ?? null,
      activeSlot: msg.activeSlot,
    });
  }

  _handleEquipSpell(player, msg) {
    const { slotIndex, spellId } = msg;
    if (slotIndex < 0 || slotIndex >= MAX_SPELL_SLOTS) return;
    if (spellId !== null && !player.unlockedNodes.has(spellId)) return;

    player.equippedSpells[slotIndex] = spellId;
  }

  /** Debug mode: grant points and immediately walk the whole tree, auto-resolving any fork instantly instead of waiting on the normal 12s vote timeout, so toggling it on unlocks (and equips) everything right away. Also flags the player so every cast/mobility/basic-attack/melee cooldown check is skipped (see SpellSystem). */
  _handleDebugGrant(player) {
    player.isDebugMode = true;
    player.skillPoints += 999;
    if (!player.class) return;
    const room = player.roomId ? this.server.rooms.get(player.roomId) : null;
    room?.progressionSystem.forceUnlockAll(player);
  }

  /** Debug mode: switch to any subclass of any class mid-session -- no respawn, so whatever's currently running (bots, an Experiment Lab session) just keeps going. */
  _handleDebugSetBranch(player, msg) {
    if (!player.isDebugMode || !player.roomId) return;
    if (!CLASSES.includes(msg?.class)) return;
    const room = this.server.rooms.get(player.roomId);
    room?.progressionSystem.setDebugSubclass(player, msg.class, msg.branch);
  }

  _handleBuyNode(player, msg) {
    const { nodeId } = msg;
    if (!nodeId || !player.class || player.skillPoints <= 0) return;

    const node = getNode(player.class, nodeId);
    if (!node) return;
    if (!canUnlockNode(node, player.unlockedNodes)) return;

    player.unlockedNodes.add(nodeId);
    player.skillPoints--;
    this.server.persistPlayer(player);

    this.server.send(player, {
      type: 's2c:skill_bought',
      nodeId,
      skillPoints: player.skillPoints,
    });
  }

  /** Spend 1 skill point to reveal a glossary lore entry without unlocking the node itself -- see Player.revealedLore. */
  _handleRevealLore(player, msg) {
    const { nodeId } = msg;
    if (!nodeId || !player.class || player.skillPoints <= 0) return;

    const node = getNode(player.class, nodeId);
    if (!node) return;
    if (player.unlockedNodes.has(nodeId) || player.revealedLore.has(nodeId)) return;

    player.revealedLore.add(nodeId);
    player.skillPoints--;
    this.server.persistPlayer(player);

    this.server.send(player, {
      type: S2C.LORE_REVEALED,
      nodeId,
      skillPoints: player.skillPoints,
    });
  }

  _handleRespawn(player, msg) {
    if (!player.roomId || player.isAlive) return;
    const room = this.server.rooms.get(player.roomId);
    if (!room || !room.respawnEnabled) return; // match rooms: eliminated means eliminated until MATCH_END

    if (msg?.newClass && CLASSES.includes(msg.newClass) && msg.newClass !== player.class) {
      player.selectClass(msg.newClass);
    } else if (msg?.switchBranch) {
      room.progressionSystem.switchBranch(player);
    }

    room.spawnPlayer(player);
    room.progressionSystem.tryAutoUnlock(player);
  }

  /** Practice/fun tool, open to any player: fills the room with one aggressive bot per class. */
  _handleSpawnBots(player, msg) {
    if (!player.roomId) return;
    const room = this.server.rooms.get(player.roomId);
    if (!room) return;
    for (const wizardClass of CLASSES) {
      room.spawnBot({ class: wizardClass, behavior: 'aggressive' });
    }
  }

  _handleDespawnBots(player, msg) {
    if (!player.roomId) return;
    const room = this.server.rooms.get(player.roomId);
    if (!room) return;
    for (const botId of [...room.botControllers.keys()]) {
      room.despawnBot(botId);
    }
  }

  // ── Experiment Lab (localhost-only) ─────────────────────────────────────

  _handleSpawnBot(player, msg) {
    if (!player.isLocalConnection || !player.roomId) return;
    const room = this.server.rooms.get(player.roomId);
    if (!room || !CLASSES.includes(msg.class)) return;
    const behavior = ['static', 'docile', 'aggressive'].includes(msg.behavior) ? msg.behavior : 'aggressive';
    const loadout = Array.isArray(msg.loadout) && msg.loadout.length === 4 ? msg.loadout : null;
    const autoEquipOnLevel = msg.autoEquipOnLevel !== false;
    room.spawnBot({ class: msg.class, behavior, position: msg.position ?? null, loadout, autoEquipOnLevel });
  }

  _handleDespawnBot(player, msg) {
    if (!player.isLocalConnection || !player.roomId) return;
    const room = this.server.rooms.get(player.roomId);
    if (!room || !msg.botId) return;
    room.despawnBot(msg.botId);
  }

  _handleSetBotBehavior(player, msg) {
    if (!player.isLocalConnection || !player.roomId) return;
    const room = this.server.rooms.get(player.roomId);
    if (!room?.botControllers.has(msg.botId)) return;
    if (!['static', 'docile', 'aggressive'].includes(msg.behavior)) return;
    const bot = this.server.players.get(msg.botId);
    if (bot) bot.behavior = msg.behavior;
  }

  _handleSetBotLoadout(player, msg) {
    if (!player.isLocalConnection || !player.roomId) return;
    const room = this.server.rooms.get(player.roomId);
    if (!room?.botControllers.has(msg.botId)) return;
    if (!Array.isArray(msg.equippedSpells) || msg.equippedSpells.length !== 4) return;
    const bot = this.server.players.get(msg.botId);
    if (bot) bot.equippedSpells = msg.equippedSpells.map((id) => (typeof id === 'string' ? id : null));
  }

  _handleSetBotAutoEquip(player, msg) {
    if (!player.isLocalConnection || !player.roomId) return;
    const room = this.server.rooms.get(player.roomId);
    if (!room?.botControllers.has(msg.botId)) return;
    const bot = this.server.players.get(msg.botId);
    if (bot) bot.autoEquipOnLevel = !!msg.autoEquipOnLevel;
  }

  _handleRunSimulation(player, msg) {
    if (!player.isLocalConnection) return;
    const { matchup, rounds } = msg;
    if (!Array.isArray(matchup) || matchup.length !== 2) return;
    if (!matchup.every((side) => CLASSES.includes(side?.class))) return;
    const boundedRounds = Math.max(1, Math.min(500, Math.floor(rounds) || 20));

    this.server.simulationRunner
      .run({ matchup, rounds: boundedRounds }, (completed, total) => {
        this.server.send(player, { type: S2C.SIMULATION_PROGRESS, completed, total });
      })
      .then((result) => {
        // Spread first, override `type` after — result.type is the worker's
        // own internal message tag ('result'), not the S2C wire type.
        this.server.send(player, { ...result, type: S2C.SIMULATION_RESULT });
      })
      .catch((err) => {
        this.server.send(player, { type: S2C.ERROR, message: `Simulation failed: ${err.message}` });
      });
  }

  /**
   * Design Lab "Save to repo": persist picked card looks into
   * client/src/data/cardRecipeBank.json.
   *
   * This is the one handler that touches the filesystem, so it's the one
   * worth being paranoid in: localhost-gated like the rest of the lab, but
   * additionally the payload is rebuilt field by field rather than
   * stringified as-received. A recipe is a fixed set of scalars, so anything
   * the client sends that isn't one of them simply doesn't survive the trip.
   */
  async _handleSaveCardRecipes(player, msg) {
    if (!player.isLocalConnection) return;

    const bank = {};
    for (const [id, entry] of Object.entries(msg.bank ?? {})) {
      const recipe = sanitizeRecipe(entry?.recipe);
      // Key and recipe id must agree, or assignments would dangle.
      if (!recipe || recipe.id !== id) continue;
      bank[id] = {
        recipe,
        ...(typeof entry.note === 'string' && entry.note ? { note: entry.note.slice(0, 200) } : {}),
        ...(Array.isArray(entry.assigned)
          ? { assigned: entry.assigned.filter((s) => typeof s === 'string' && s in ALL_SPELLS) }
          : {}),
      };
    }

    const assignments = {};
    for (const [spellId, recipeId] of Object.entries(msg.assignments ?? {})) {
      // Drop assignments pointing at spells or recipes that don't exist --
      // otherwise a stale localStorage entry gets committed to the repo.
      if (spellId in ALL_SPELLS && typeof recipeId === 'string' && bank[recipeId]) {
        assignments[spellId] = recipeId;
      }
    }

    try {
      await writeFile(CARD_BANK_PATH, `${JSON.stringify({ bank, assignments }, null, 2)}\n`, 'utf8');
      console.log(`[design-lab] wrote ${Object.keys(bank).length} recipes, ${Object.keys(assignments).length} assignments`);
    } catch (err) {
      this.server.send(player, { type: S2C.ERROR, message: `Could not write card bank: ${err.message}` });
    }
  }

  _handleVoteResolve(player, msg) {
    const { promptId, choice } = msg;
    if (!player.roomId || !promptId || !choice) return;
    const room = this.server.rooms.get(player.roomId);
    if (room) room.progressionSystem.resolveVote(player, promptId, choice);
  }
}

/**
 * Rebuild a CardRecipe from untrusted input, keeping only the fields the
 * schema defines and forcing each to its expected type and range.
 *
 * Deliberately checks *shape* rather than exact enum membership: the
 * vocabularies (frame names, motion kinds, ...) live in the client's
 * cardRecipe.ts and get extended regularly, and a server-side copy of them
 * would silently start rejecting new looks the moment the two drifted. An
 * unknown frame name renders as the default silhouette, which is a cosmetic
 * miss; junk written into a source file is not. So the invariant enforced
 * here is "this is a well-formed recipe object", not "these are looks I
 * recognise".
 */
function sanitizeRecipe(r) {
  if (!r || typeof r !== 'object') return null;

  const str = (v, fallback) => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : fallback);
  const num = (v, min, max, fallback) =>
    (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

  const id = str(r.id, null);
  const name = str(r.name, null);
  if (!id || !name) return null;
  // ids become object keys in a committed JSON file and slugs elsewhere.
  if (!/^[a-z0-9-]+$/.test(id)) return null;

  return {
    id,
    name: name.slice(0, 64),
    grade: num(r.grade, 0, 1, 0),
    frame: str(r.frame, 'plain'),
    border: str(r.border, 'flat'),
    borderWidth: num(r.borderWidth, 0, 8, 2),
    fill: str(r.fill, 'gradient'),
    paletteMod: str(r.paletteMod, 'natural'),
    texture: str(r.texture, 'none'),
    textureDensity: num(r.textureDensity, 0, 1, 0),
    motion: Array.isArray(r.motion)
      ? r.motion.filter((m) => typeof m === 'string' && m.length <= 32).slice(0, 4)
      : [],
    motionRate: num(r.motionRate, 0, 1, 0),
    sigilRing: str(r.sigilRing, 'none'),
    sigilHalo: num(r.sigilHalo, 0, 1, 0),
    corner: str(r.corner, 'none'),
    nameCase: str(r.nameCase, 'normal'),
    aura: num(r.aura, 0, 1, 0),
    auraPulse: !!r.auraPulse,
    seed: num(r.seed, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

class ClockSyncHandler {
  constructor(server) {
    this.server = server;
  }

  handle(player, msg) {
    const t2 = Date.now();
    this.server.send(player, {
      type: 's2c:clock_sync',
      t1: msg.t1,
      t2,
      t3: Date.now(),
    });
  }
}
