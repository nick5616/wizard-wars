/**
 * N-way single-elimination bracket for the Experiment Lab's tournament tab.
 * Each match reuses the existing 1v1 RUN_SIMULATION/SIMULATION_RESULT
 * channel (server already runs a headless simulated match for exactly two
 * sides) — the bracket just orchestrates a sequence of those pairwise
 * simulations, round by round, and renders the tree.
 *
 * Winner is read from result.winRateBySide (index-disambiguated) rather
 * than winRateByClass, since two bracket slots can easily share a class
 * once the bracket is bigger than the 5 available classes.
 */

import { useEffect, useRef, useState } from 'react';
import { getSpell, ALL_SPELLS, BASIC_ATTACK, MELEE_ATTACK } from 'shared/spells';
import { C2S, S2C } from 'shared/events';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import type { WizardClass, SimulationResult } from '../../types/game.types';
import { UIButton } from './UIButton';
import { SpellTypeIcon } from './SpellTypeIcon';

const CLASS_COLORS: Record<WizardClass, string> = {
  fire: '#ff4500', ice: '#a0d8ff', dark: '#cc00ff', sword: '#c8c8c8', earth: '#8B6914',
};

const BRACKET_SIZES = [4, 8] as const;
type BracketSize = (typeof BRACKET_SIZES)[number];

interface Participant {
  id: string;
  label: string;
  class: WizardClass;
  loadout: (string | null)[];
}

interface Match {
  round: number;
  slot: number;
  a: Participant | null;
  b: Participant | null;
  winner: Participant | null;
  winnerRate: number | null; // winning side's win rate, for display
}

// Basic attack (RMB) / melee (F) are always-on per-class abilities outside
// the 4 equip slots -- not real loadout options (see ExperimentLab.tsx).
const ALWAYS_AVAILABLE_IDS = new Set<string>([...Object.values(BASIC_ATTACK), ...Object.values(MELEE_ATTACK)]);

function equippableSpells(wizardClass: WizardClass) {
  return Object.values(ALL_SPELLS).filter((s) => s.class === wizardClass && s.type !== 'passive' && s.type !== 'mobility' && !ALWAYS_AVAILABLE_IDS.has(s.id));
}

function defaultLoadout(wizardClass: WizardClass): (string | null)[] {
  const spells = equippableSpells(wizardClass).sort((a, b) => a.tier - b.tier);
  return [spells[0]?.id ?? null, spells[1]?.id ?? null, null, null];
}

function makeParticipant(index: number, wizardClass: WizardClass): Participant {
  return { id: `p${index}-${Date.now()}`, label: `#${index + 1} ${wizardClass}`, class: wizardClass, loadout: defaultLoadout(wizardClass) };
}

function buildInitialMatches(participants: Participant[]): Match[][] {
  const roundCount = Math.log2(participants.length);
  const rounds: Match[][] = [];
  for (let r = 0; r < roundCount; r++) {
    const matchCount = participants.length / 2 ** (r + 1);
    const matches: Match[] = [];
    for (let s = 0; s < matchCount; s++) {
      matches.push({
        round: r,
        slot: s,
        a: r === 0 ? participants[s * 2] : null,
        b: r === 0 ? participants[s * 2 + 1] : null,
        winner: null,
        winnerRate: null,
      });
    }
    rounds.push(matches);
  }
  return rounds;
}

export function TournamentBracket({ ws }: { ws: WebSocketClient }) {
  const [size, setSize] = useState<BracketSize>(4);
  const [participants, setParticipants] = useState<Participant[]>(() =>
    Array.from({ length: 4 }, (_, i) => makeParticipant(i, (['fire', 'ice', 'dark', 'sword'] as WizardClass[])[i % 4])));
  const [rounds, setRounds] = useState<Match[][] | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [viewing, setViewing] = useState<Participant | null>(null);

  const runningRef = useRef<{ round: number; slot: number } | null>(null);

  function resize(n: BracketSize) {
    setSize(n);
    setRounds(null);
    setParticipants((prev) => {
      const classes: WizardClass[] = ['fire', 'ice', 'dark', 'sword', 'earth'];
      const next = [...prev];
      while (next.length < n) next.push(makeParticipant(next.length, classes[next.length % classes.length]));
      return next.slice(0, n);
    });
  }

  function setParticipant(index: number, patch: Partial<Participant>) {
    setParticipants((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function startBracket() {
    const built = buildInitialMatches(participants);
    setRounds(built);
    setRunning(true);
  }

  // Drives the bracket forward: finds the next unresolved match with both
  // sides known and kicks it off, one at a time.
  useEffect(() => {
    if (!running || !rounds) return;
    if (runningRef.current) return; // a match is already in flight

    let next: { round: number; slot: number; a: Participant; b: Participant } | null = null;
    outer: for (let r = 0; r < rounds.length; r++) {
      for (const m of rounds[r]) {
        if (m.winner) continue;
        if (m.a && m.b) { next = { round: r, slot: m.slot, a: m.a, b: m.b }; break outer; }
      }
    }

    if (!next) { setRunning(false); return; }

    runningRef.current = { round: next.round, slot: next.slot };
    setProgress({ completed: 0, total: 25 });
    ws.send(C2S.RUN_SIMULATION, {
      matchup: [{ class: next.a.class, loadout: next.a.loadout }, { class: next.b.class, loadout: next.b.loadout }],
      rounds: 25,
    });
  }, [running, rounds, ws]);

  useEffect(() => {
    const offProgress = ws.on(S2C.SIMULATION_PROGRESS, (msg) => {
      setProgress({ completed: msg.completed as number, total: msg.total as number });
    });
    const offResult = ws.on(S2C.SIMULATION_RESULT, (msg) => {
      const inFlight = runningRef.current;
      if (!inFlight) return;
      runningRef.current = null;
      setProgress(null);

      const result = msg as unknown as SimulationResult;
      setRounds((prev) => {
        if (!prev) return prev;
        const match = prev[inFlight.round][inFlight.slot];
        if (!match.a || !match.b) return prev;
        const rate0 = result.winRateBySide?.[0] ?? result.winRateByClass[match.a.class] ?? 0;
        const rate1 = result.winRateBySide?.[1] ?? result.winRateByClass[match.b.class] ?? 0;
        const winner = rate0 >= rate1 ? match.a : match.b;
        const winnerRate = Math.max(rate0, rate1);

        const next = prev.map((round) => round.map((m) => ({ ...m })));
        next[inFlight.round][inFlight.slot].winner = winner;
        next[inFlight.round][inFlight.slot].winnerRate = winnerRate;

        // Advance winner into the next round's slot, if there is one.
        if (inFlight.round + 1 < next.length) {
          const nextMatch = next[inFlight.round + 1][Math.floor(inFlight.slot / 2)];
          if (inFlight.slot % 2 === 0) nextMatch.a = winner; else nextMatch.b = winner;
        }
        return next;
      });
    });
    return () => { offProgress(); offResult(); };
  }, [ws]);

  const champion = rounds ? rounds[rounds.length - 1]?.[0]?.winner ?? null : null;

  if (viewing) {
    return <LoadoutDetail participant={viewing} onBack={() => setViewing(null)} />;
  }

  return (
    <div>
      {!rounds ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ color: '#aaa', fontSize: 11 }}>Bracket size</span>
            {BRACKET_SIZES.map((n) => (
              <UIButton
                key={n}
                onClick={() => resize(n)}
                style={{
                  padding: '4px 12px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
                  background: size === n ? 'rgba(0,150,120,0.2)' : 'none',
                  border: `1px solid ${size === n ? '#2a6b5a' : '#333'}`,
                  color: size === n ? '#66ddaa' : '#aaa',
                }}
              >
                {n}
              </UIButton>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
            {participants.map((p, i) => (
              <ParticipantConfigCard key={p.id} participant={p} onChange={(patch) => setParticipant(i, patch)} />
            ))}
          </div>

          <UIButton
            onClick={startBracket}
            style={{ padding: '8px 20px', background: 'rgba(0,150,0,0.15)', border: '1px solid #2a6b2a', borderRadius: 3, color: '#8fdb8f', fontSize: 11, letterSpacing: 2, cursor: 'pointer', textTransform: 'uppercase' }}
          >
            Start Bracket
          </UIButton>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ color: '#aaa', fontSize: 11 }}>
              {champion ? <span style={{ color: '#ffcc44' }}>Champion: {champion.label}</span> : running ? 'Running…' : 'Paused'}
            </div>
            <UIButton
              onClick={() => { setRounds(null); setRunning(false); runningRef.current = null; setProgress(null); }}
              style={{ padding: '4px 10px', background: 'none', border: '1px solid #444', borderRadius: 3, color: '#aaa', fontSize: 10, letterSpacing: 1, cursor: 'pointer' }}
            >
              Reconfigure
            </UIButton>
          </div>

          {progress && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ height: 5, background: '#1a1a2e', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(progress.completed / progress.total) * 100}%`, background: '#66ddaa', transition: 'width 120ms linear' }} />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 28, overflowX: 'auto', paddingBottom: 8 }}>
            {rounds.map((round, ri) => (
              <div key={ri} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-around', gap: 14, minWidth: 190 }}>
                <div style={{ color: '#666', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 2 }}>
                  {ri === rounds.length - 1 ? 'Final' : `Round ${ri + 1}`}
                </div>
                {round.map((m, mi) => (
                  <MatchCard key={mi} match={m} onView={setViewing} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MatchCard({ match, onView }: { match: Match; onView: (p: Participant) => void }) {
  return (
    <div style={{ border: '1px solid #252535', borderRadius: 4, overflow: 'hidden' }}>
      <MatchSlot participant={match.a} isWinner={!!match.winner && match.winner.id === match.a?.id} onView={onView} />
      <div style={{ height: 1, background: '#252535' }} />
      <MatchSlot participant={match.b} isWinner={!!match.winner && match.winner.id === match.b?.id} onView={onView} />
      {match.winner && match.winnerRate != null && (
        <div style={{ padding: '3px 8px', color: '#666', fontSize: 9, borderTop: '1px solid #1c1c2c' }}>
          {Math.round(match.winnerRate * 100)}% win rate
        </div>
      )}
    </div>
  );
}

function MatchSlot({ participant, isWinner, onView }: { participant: Participant | null; isWinner: boolean; onView: (p: Participant) => void }) {
  if (!participant) {
    return <div style={{ padding: '8px 10px', color: '#555', fontSize: 11, fontStyle: 'italic' }}>TBD</div>;
  }
  const color = CLASS_COLORS[participant.class];
  return (
    <div
      onClick={() => onView(participant)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer',
        background: isWinner ? `${color}18` : 'transparent', opacity: isWinner ? 1 : 0.7,
      }}
      title="Click to view loadout"
    >
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ color: isWinner ? color : '#ccc', fontSize: 11, flex: 1 }}>{participant.label}</span>
      {isWinner && <span style={{ color, fontSize: 10 }}>✓</span>}
    </div>
  );
}

function ParticipantConfigCard({ participant, onChange }: { participant: Participant; onChange: (patch: Partial<Participant>) => void }) {
  const color = CLASS_COLORS[participant.class];
  const options = equippableSpells(participant.class);

  function setClass(c: WizardClass) {
    onChange({ class: c, loadout: defaultLoadout(c), label: participant.label.replace(/\s\w+$/, ` ${c}`) });
  }

  function setSlot(slot: number, spellId: string | null) {
    const next = [...participant.loadout];
    next[slot] = spellId;
    onChange({ loadout: next });
  }

  return (
    <div style={{ border: `1px solid ${color}33`, borderRadius: 4, padding: 10 }}>
      <div style={{ color, fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>{participant.label}</div>
      <select value={participant.class} onChange={(e) => setClass(e.target.value as WizardClass)} style={{ ...selectStyle, width: '100%', marginBottom: 5 }}>
        {(['fire', 'ice', 'dark', 'sword', 'earth'] as WizardClass[]).map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 4 }}>
        {[0, 1, 2, 3].map((slot) => (
          <select key={slot} value={participant.loadout[slot] ?? ''} onChange={(e) => setSlot(slot, e.target.value || null)} style={{ ...selectStyle, flex: 1, fontSize: 9 }}>
            <option value="">—</option>
            {options.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ))}
      </div>
    </div>
  );
}

/** Full detail view of one participant's loadout — a modal-like takeover with a back arrow, per the ask. */
function LoadoutDetail({ participant, onBack }: { participant: Participant; onBack: () => void }) {
  const color = CLASS_COLORS[participant.class];
  return (
    <div>
      <UIButton
        onClick={onBack}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid #333', borderRadius: 3, color: '#ccc', fontSize: 11, padding: '5px 12px', cursor: 'pointer', marginBottom: 18 }}
      >
        ← Back
      </UIButton>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
        <span style={{ color, fontSize: 15, letterSpacing: 1 }}>{participant.label}</span>
      </div>

      <div style={{ color: '#888', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>Loadout</div>
      {participant.loadout.map((spellId, i) => {
        const spell = spellId ? getSpell(spellId) : null;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #1c1c2c' }}>
            <div style={{ color: '#666', fontSize: 10, width: 16 }}>{i + 1}</div>
            {spell ? (
              <>
                <SpellTypeIcon kind={spell.type} size={16} color={color} />
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: spell.color, boxShadow: `0 0 4px ${spell.glowColor}` }} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#ddd', fontSize: 13 }}>{spell.name}</div>
                  <div style={{ color: '#777', fontSize: 10, marginTop: 2 }}>
                    {spell.damage > 0 && <span style={{ marginRight: 10 }}>{spell.damage} dmg</span>}
                    {spell.cooldown > 0 && <span style={{ marginRight: 10 }}>{spell.cooldown}s cd</span>}
                    {spell.statusEffect && <span style={{ color: '#aa88ff' }}>+{spell.statusEffect}</span>}
                  </div>
                </div>
                <div style={{ color: '#555', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>{spell.type}</div>
              </>
            ) : (
              <div style={{ color: '#555', fontSize: 12, fontStyle: 'italic' }}>— empty —</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const selectStyle = {
  background: '#0c0c16', border: '1px solid #333', borderRadius: 3, color: '#ddd',
  fontSize: 11, padding: '5px 6px', fontFamily: "'Courier New', monospace",
} as const;
