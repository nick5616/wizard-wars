/**
 * Live feed of bot-involved combat events (hits/headshots and kills),
 * broadcast by the server (see Room.applyDamage / Room._handleDeath,
 * gated to fights where at least one side is a bot). Kills show the
 * running head-to-head record between those two specific combatants,
 * e.g. "(3 - 1)" — the killer has beaten this victim 3 times, and this
 * victim has beaten the killer once.
 *
 * Lives on the main HUD (top-center, under NotificationFeed) rather than
 * tucked inside the Experiment Lab panel, so it's visible while spectating
 * bots — including in bird's-eye view with the panel closed.
 */

import { useEffect, useState } from 'react';
import { getSpell } from 'shared/spells';
import { S2C } from 'shared/events';
import { useNetworkStore } from '../../stores/networkStore';
import { IS_LOCALHOST } from '../../utils/isLocalhost';
import type { WebSocketClient } from '../../networking/WebSocketClient';

interface LogEntry {
  id: string;
  text: string;
  color: string;
}

const MAX_ENTRIES = 40;

export function useCombatLog(ws: WebSocketClient) {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  useEffect(() => {
    const off = ws.on(S2C.COMBAT_LOG, (msg) => {
      const spellName = msg.spellId ? (getSpell(msg.spellId as string)?.name ?? String(msg.spellId)) : 'an attack';
      const source = msg.sourceName as string;
      const target = msg.targetName as string;

      let text: string;
      let color: string;
      if (msg.kind === 'kill') {
        const killerWins = msg.killerWins as number;
        const victimWins = msg.victimWins as number;
        text = `${source} killed ${target} with ${spellName} (${killerWins} - ${victimWins})`;
        color = '#ff7766';
      } else {
        const verb = msg.isHeadshot ? 'headshot' : 'hit';
        text = `${source} ${verb} ${target} with ${spellName} for ${msg.damage as number} damage`;
        color = msg.isHeadshot ? '#ffcc44' : '#66dd88';
      }

      setEntries((prev) => [{ id: `${Date.now()}-${Math.random()}`, text, color }, ...prev].slice(0, MAX_ENTRIES));
    });
    return off;
  }, [ws]);

  return entries;
}

export function CombatLogHUD({ ws }: { ws: WebSocketClient }) {
  const entries = useCombatLog(ws);
  const { roomId } = useNetworkStore();
  const inExperiment = !!roomId && roomId.startsWith('experiment-');

  // Experiment-only feature -- never shows for a deployed server's real players,
  // and stays hidden outside your own experiment room even on localhost.
  if (!IS_LOCALHOST || !inExperiment || entries.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 60,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 640,
      maxWidth: '90vw',
      maxHeight: 190,
      overflowY: 'auto',
      background: 'rgba(0,0,0,0.65)',
      border: '1px solid #2a2a3c',
      borderRadius: 4,
      padding: '6px 14px',
      pointerEvents: 'none',
      zIndex: 90,
      fontFamily: "'Courier New', monospace",
    }}>
      {entries.map((e) => (
        <div key={e.id} style={{ color: e.color, fontSize: 11, padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {e.text}
        </div>
      ))}
    </div>
  );
}
