import { Player } from './Player.js';

/**
 * A bot-controlled combatant. Subclasses Player (not a parallel duck-typed
 * class) so it automatically picks up every field/method Player gains over
 * time, and flows through every existing server.players / room.playerIds
 * lookup unmodified — bots are just Players with ws: null and a controller.
 */
export class Bot extends Player {
  constructor({ id, username, class: wizardClass, behavior = 'aggressive', autoEquipOnLevel = true }) {
    super({ id, ws: null, username });
    this.isBot = true;
    this.behavior = behavior; // 'static' | 'docile' | 'aggressive'
    // Whether ProgressionSystem.tryAutoUnlock runs for this bot on kill (see
    // Room.js's kill handler) -- on by default, matching how every human
    // player's skill points already auto-spend. Toggleable per-bot from the
    // Experiment Lab so a bot can be pinned to its starting loadout for
    // controlled matchup testing instead of leveling up mid-session.
    this.autoEquipOnLevel = autoEquipOnLevel;
    this.rtt = 0; // no real network round trip — hitscan lag-comp shouldn't rewind time for bots
    this.ping = 0;
    this._inputSeq = 0;

    if (wizardClass) this.selectClass(wizardClass);
  }

  nextInputSeq() {
    return ++this._inputSeq;
  }

  serialize() {
    return { ...super.serialize(), isBot: true, behavior: this.behavior, autoEquipOnLevel: this.autoEquipOnLevel };
  }
}
