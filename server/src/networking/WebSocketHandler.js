import { C2S } from 'shared/events';
import { getNode, canUnlockNode } from 'shared/skillTrees';
import { CLASSES } from 'shared/constants';

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
      case C2S.DEBUG_GRANT:    player.skillPoints += 999; break;
      default: break;
    }
  }

  _handleJoinRoom(player, msg) {
    const roomId = msg.roomId ?? 'lobby';
    const room = this.server.getOrCreateRoom(roomId);

    if (msg.username) player.username = msg.username.slice(0, 20);
    room.addPlayer(player);
  }

  _handleSelectClass(player, msg) {
    const validClasses = ['fire', 'ice', 'dark', 'sword', 'earth'];
    if (!validClasses.includes(msg.class)) return;

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
    });
  }

  _handleEquipSpell(player, msg) {
    const { slotIndex, spellId } = msg;
    if (slotIndex < 0 || slotIndex > 3) return;
    if (spellId !== null && !player.unlockedNodes.has(spellId)) return;

    player.equippedSpells[slotIndex] = spellId;
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

  _handleVoteResolve(player, msg) {
    const { branchGroup, choice } = msg;
    if (!player.roomId || !branchGroup || !choice) return;
    const room = this.server.rooms.get(player.roomId);
    if (room) room.progressionSystem.resolveVote(player, branchGroup, choice);
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
