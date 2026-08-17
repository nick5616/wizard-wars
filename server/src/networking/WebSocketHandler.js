import { C2S, S2C } from 'shared/events';
import { getNode, canUnlockNode } from 'shared/skillTrees';
import { CLASSES } from 'shared/constants';
import { MAX_SPELL_SLOTS } from 'shared/spells';

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
      case C2S.RESPAWN:        this._handleRespawn(player, msg); break;
      case C2S.SKILL_VOTE_RESOLVE: this._handleVoteResolve(player, msg); break;
      case C2S.DEBUG_GRANT:    this._handleDebugGrant(player); break;
      case C2S.SPAWN_BOTS:     this._handleSpawnBots(player, msg); break;
      case C2S.DESPAWN_BOTS:   this._handleDespawnBots(player, msg); break;
      case C2S.SPAWN_BOT:        this._handleSpawnBot(player, msg); break;
      case C2S.DESPAWN_BOT:      this._handleDespawnBot(player, msg); break;
      case C2S.SET_BOT_BEHAVIOR: this._handleSetBotBehavior(player, msg); break;
      case C2S.SET_BOT_LOADOUT:  this._handleSetBotLoadout(player, msg); break;
      case C2S.SET_BOT_AUTO_EQUIP: this._handleSetBotAutoEquip(player, msg); break;
      case C2S.RUN_SIMULATION:   this._handleRunSimulation(player, msg); break;
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
  }

  _leaveCurrentRoom(player) {
    if (!player.roomId) return;
    const oldRoomId = player.roomId;
    this.server.rooms.get(oldRoomId)?.removePlayer(player.id);
    this.server.cleanupEmptyExperimentRoom(oldRoomId);
    player.roomId = null;
  }

  _handleSelectClass(player, msg) {
    const validClasses = ['fire', 'ice', 'dark', 'sword', 'earth'];
    if (!validClasses.includes(msg.class)) return;

    if (typeof msg.username === 'string' && msg.username.trim()) {
      player.username = msg.username.trim().slice(0, 20);
    }
    player.selectClass(msg.class);

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

  _handleBuyNode(player, msg) {
    const { nodeId } = msg;
    if (!nodeId || !player.class || player.skillPoints <= 0) return;

    const node = getNode(player.class, nodeId);
    if (!node) return;
    if (!canUnlockNode(node, player.unlockedNodes)) return;

    player.unlockedNodes.add(nodeId);
    player.skillPoints--;

    this.server.send(player, {
      type: 's2c:skill_bought',
      nodeId,
      skillPoints: player.skillPoints,
    });
  }

  _handleRespawn(player, msg) {
    if (!player.roomId || player.isAlive) return;
    const room = this.server.rooms.get(player.roomId);
    if (!room) return;

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

  _handleVoteResolve(player, msg) {
    const { promptId, choice } = msg;
    if (!player.roomId || !promptId || !choice) return;
    const room = this.server.rooms.get(player.roomId);
    if (room) room.progressionSystem.resolveVote(player, promptId, choice);
  }
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
