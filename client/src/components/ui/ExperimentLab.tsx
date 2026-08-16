/**
 * Localhost-only sandbox: spawn/tune bots with god-mode on, and run headless
 * tournament simulations to compare class loadouts. The server is the real
 * gate (Player.isLocalConnection) — this panel simply isn't shown unless
 * window.location.hostname is localhost/127.0.0.1 (see App.tsx).
 */

import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { ALL_SPELLS, BASIC_ATTACK, MELEE_ATTACK } from 'shared/spells';
import { CLASSES } from 'shared/constants';
import { C2S, S2C } from 'shared/events';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import type { WizardClass, SimulationResult } from '../../types/game.types';
import { UIButton } from './UIButton';
import { TournamentBracket } from './TournamentBracket';

const CLASS_COLORS: Record<WizardClass, string> = {
  fire: '#ff4500', ice: '#a0d8ff', dark: '#cc00ff', sword: '#c8c8c8', earth: '#8B6914',
};

const BEHAVIORS = ['static', 'docile', 'aggressive'] as const;
type Behavior = (typeof BEHAVIORS)[number];

// Basic attack (RMB) and melee (F) are always-on per-class abilities outside
// the equip slots (see shared/spells.js) -- they're in ALL_SPELLS so combat
// code can look them up by id, but they were never meant to be pickable as a
// loadout slot. Putting e.g. "Punch" in a slot didn't make the bot punch-only
// -- it just added a redundant, silently-broken slot (melee has no
// slot-cast handling at all, see SpellSystem._dispatchCast) while RMB/F kept
// firing the real thing regardless of what was equipped.
const ALWAYS_AVAILABLE_IDS = new Set<string>([...Object.values(BASIC_ATTACK), ...Object.values(MELEE_ATTACK)]);

function equippableSpells(wizardClass: WizardClass) {
  return Object.values(ALL_SPELLS).filter((s) => s.class === wizardClass && s.type !== 'passive' && s.type !== 'mobility' && !ALWAYS_AVAILABLE_IDS.has(s.id));
}

function defaultLoadout(wizardClass: WizardClass): (string | null)[] {
  const spells = equippableSpells(wizardClass).sort((a, b) => a.tier - b.tier);
  return [spells[0]?.id ?? null, spells[1]?.id ?? null, null, null];
}

interface Props {
  ws: WebSocketClient;
  onClose: () => void;
  onReturnToLobby: () => void;
}

type Tab = 'sandbox' | 'tournament';

export function ExperimentLab({ ws, onClose, onReturnToLobby }: Props) {
  const [tab, setTab] = useState<Tab>('sandbox');

  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 600, fontFamily: "'Courier New', monospace",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
          const canvas = document.querySelector('canvas');
          if (canvas) setTimeout(() => { if (!document.pointerLockElement) canvas.requestPointerLock(); }, 50);
        }
      }}
    >
      <div style={{
        width: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        background: 'rgba(6,6,16,0.98)', border: '1px solid #66ddaa44', borderRadius: 6, overflow: 'hidden',
      }}>
        <div style={{ padding: '18px 24px 12px', borderBottom: '1px solid #252535', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: '#66ddaa', fontSize: 11, letterSpacing: 5, textTransform: 'uppercase' }}>Experiment Lab</div>
            <div style={{ color: '#888', fontSize: 10, letterSpacing: 1, marginTop: 3 }}>localhost only — god mode active in this room</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <UIButton onClick={onReturnToLobby} style={smallBtnStyle('#664400', '#ffcc66')}>Return to lobby</UIButton>
            <UIButton onClick={onClose} locksPointer style={smallBtnStyle('#444', '#ccc')}>ESC</UIButton>
          </div>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid #252535' }}>
          {(['sandbox', 'tournament'] as Tab[]).map((t) => (
            <UIButton
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, background: 'none', border: 'none',
                borderBottom: tab === t ? '2px solid #66ddaa' : '2px solid transparent',
                color: tab === t ? '#66ddaa' : '#aaa',
                fontSize: 11, letterSpacing: 3, padding: '10px 0', cursor: 'pointer', textTransform: 'uppercase',
              }}
            >
              {t}
            </UIButton>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {tab === 'sandbox' ? <SandboxTab ws={ws} /> : <TournamentTab ws={ws} />}
        </div>
      </div>
    </div>
  );
}

function smallBtnStyle(border: string, color: string) {
  return {
    background: 'none', border: `1px solid ${border}`, borderRadius: 3, color,
    fontSize: 11, padding: '4px 10px', cursor: 'pointer', letterSpacing: 1,
  } as const;
}

// ── Sandbox tab ──────────────────────────────────────────────────────────

function SandboxTab({ ws }: { ws: WebSocketClient }) {
  const players = useGameStore((s) => s.players);
  const bots = useMemo(() => Object.values(players).filter((p) => p.isBot), [players]);
  const birdsEyeView = useGameStore((s) => s.birdsEyeView);
  const setBirdsEyeView = useGameStore((s) => s.setBirdsEyeView);

  const [spawnClass, setSpawnClass] = useState<WizardClass>('fire');
  const [spawnBehavior, setSpawnBehavior] = useState<Behavior>('aggressive');

  function spawnBot() {
    ws.send(C2S.SPAWN_BOT, {
      class: spawnClass, behavior: spawnBehavior, loadout: defaultLoadout(spawnClass), autoEquipOnLevel: true,
    });
  }

  return (
    <div>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, padding: '8px 10px',
        background: birdsEyeView ? 'rgba(0,150,120,0.12)' : 'transparent',
        border: `1px solid ${birdsEyeView ? '#2a6b5a' : '#252535'}`, borderRadius: 4, cursor: 'pointer',
      }}>
        <input type="checkbox" checked={birdsEyeView} onChange={(e) => setBirdsEyeView(e.target.checked)} />
        <div>
          <div style={{ color: birdsEyeView ? '#66ddaa' : '#ccc', fontSize: 12 }}>Bird's eye view</div>
          <div style={{ color: '#888', fontSize: 10, marginTop: 1 }}>Static camera above the whole arena — good for watching bots fight</div>
        </div>
      </label>

      <div style={{ color: '#aaa', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>
        Spawn a bot
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        <select value={spawnClass} onChange={(e) => setSpawnClass(e.target.value as WizardClass)} style={selectStyle}>
          {CLASSES.map((c: string) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={spawnBehavior} onChange={(e) => setSpawnBehavior(e.target.value as Behavior)} style={selectStyle}>
          {BEHAVIORS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <UIButton onClick={spawnBot} style={{ ...smallBtnStyle('#2a6b2a', '#8fdb8f'), padding: '6px 14px' }}>
          Spawn
        </UIButton>
      </div>

      <div style={{ color: '#aaa', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>
        Active bots — {bots.length}
      </div>

      {bots.length === 0 && (
        <div style={{ color: '#666', fontSize: 12, fontStyle: 'italic' }}>None spawned yet.</div>
      )}

      {bots.map((bot) => (
        <BotRow key={bot.id} bot={bot} ws={ws} />
      ))}

      <div style={{ color: '#666', fontSize: 10, marginTop: 20, paddingTop: 14, borderTop: '1px solid #1c1c2c', fontStyle: 'italic' }}>
        Live combat log now shows at the top of the main view, even with this panel closed.
      </div>
    </div>
  );
}

function BotRow({ bot, ws }: { bot: ReturnType<typeof useGameStore.getState>['players'][string]; ws: WebSocketClient }) {
  const color = bot.class ? CLASS_COLORS[bot.class] : '#888';
  const behavior = bot.behavior ?? 'aggressive';
  const autoEquip = bot.autoEquipOnLevel ?? true;

  function setBehavior(b: Behavior) {
    ws.send(C2S.SET_BOT_BEHAVIOR, { botId: bot.id, behavior: b });
  }

  function setSlot(slot: number, spellId: string | null) {
    const next = [...bot.equippedSpells];
    next[slot] = spellId;
    ws.send(C2S.SET_BOT_LOADOUT, { botId: bot.id, equippedSpells: next });
  }

  function setAutoEquip(v: boolean) {
    ws.send(C2S.SET_BOT_AUTO_EQUIP, { botId: bot.id, autoEquipOnLevel: v });
  }

  function duplicate() {
    if (!bot.class) return;
    ws.send(C2S.SPAWN_BOT, {
      class: bot.class, behavior, loadout: [...bot.equippedSpells], autoEquipOnLevel: autoEquip,
    });
  }

  const options = bot.class ? equippableSpells(bot.class) : [];

  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid #1c1c2c' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
        <div style={{ color: '#ddd', fontSize: 12, flex: 1 }}>{bot.username}</div>
        <span style={{ color: '#888', fontSize: 10 }}>HP {Math.round(bot.health)}/{bot.maxHealth}</span>
        <select value={behavior} onChange={(e) => setBehavior(e.target.value as Behavior)} style={selectStyle}>
          {BEHAVIORS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <UIButton
          onClick={duplicate}
          style={{ ...smallBtnStyle('#2a4a6b', '#8fbfdb'), padding: '3px 8px', fontSize: 10 }}
        >
          Duplicate
        </UIButton>
        <UIButton
          onClick={() => ws.send(C2S.DESPAWN_BOT, { botId: bot.id })}
          style={{ ...smallBtnStyle('#6b2a2a', '#db8f8f'), padding: '3px 8px', fontSize: 10 }}
        >
          Remove
        </UIButton>
      </div>
      <div style={{ display: 'flex', gap: 6, marginLeft: 18, marginBottom: 6 }}>
        {[0, 1, 2, 3].map((slot) => (
          <select
            key={slot}
            value={bot.equippedSpells[slot] ?? ''}
            onChange={(e) => setSlot(slot, e.target.value || null)}
            style={{ ...selectStyle, flex: 1 }}
          >
            <option value="">— empty —</option>
            {options.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ))}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 18, color: '#999', fontSize: 10, letterSpacing: 0.5, cursor: 'pointer' }}>
        <input type="checkbox" checked={autoEquip} onChange={(e) => setAutoEquip(e.target.checked)} />
        Auto-equip spells on level
      </label>
    </div>
  );
}

// ── Tournament tab ───────────────────────────────────────────────────────

interface SideConfig {
  class: WizardClass;
  loadout: (string | null)[];
}

function TournamentTab({ ws }: { ws: WebSocketClient }) {
  const [bracketMode, setBracketMode] = useState(false);
  const [sideA, setSideA] = useState<SideConfig>({ class: 'fire', loadout: defaultLoadout('fire') });
  const [sideB, setSideB] = useState<SideConfig>({ class: 'ice', loadout: defaultLoadout('ice') });
  const [rounds, setRounds] = useState(50);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const offProgress = ws.on(S2C.SIMULATION_PROGRESS, (msg) => {
      setProgress({ completed: msg.completed as number, total: msg.total as number });
    });
    const offResult = ws.on(S2C.SIMULATION_RESULT, (msg) => {
      setRunning(false);
      setProgress(null);
      setResult(msg as unknown as SimulationResult);
    });
    const offError = ws.on(S2C.ERROR, (msg) => {
      setRunning(false);
      setProgress(null);
      setError(String(msg.message ?? 'Simulation failed'));
    });
    return () => { offProgress(); offResult(); offError(); };
  }, [ws]);

  function run() {
    setResult(null);
    setError(null);
    setRunning(true);
    ws.send(C2S.RUN_SIMULATION, {
      matchup: [{ class: sideA.class, loadout: sideA.loadout }, { class: sideB.class, loadout: sideB.loadout }],
      rounds,
    });
  }

  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, cursor: 'pointer' }}>
        <input type="checkbox" checked={bracketMode} onChange={(e) => setBracketMode(e.target.checked)} />
        <div>
          <div style={{ color: bracketMode ? '#66ddaa' : '#ccc', fontSize: 12 }}>Bracket view</div>
          <div style={{ color: '#888', fontSize: 10, marginTop: 1 }}>Define a multi-participant single-elimination bracket instead of a single 1v1</div>
        </div>
      </label>

      {bracketMode ? (
        <TournamentBracket ws={ws} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 18 }}>
            <SideConfigPanel label="Side A" config={sideA} onChange={setSideA} />
            <SideConfigPanel label="Side B" config={sideB} onChange={setSideB} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ color: '#aaa', fontSize: 11 }}>Rounds</span>
            <input
              type="number" min={1} max={500} value={rounds}
              onChange={(e) => setRounds(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
              style={{ ...selectStyle, width: 70 }}
            />
            <UIButton
              onClick={run}
              disabled={running}
              style={{ ...smallBtnStyle('#2a6b2a', '#8fdb8f'), padding: '6px 16px', opacity: running ? 0.5 : 1 }}
            >
              {running ? 'Running…' : 'Run Simulation'}
            </UIButton>
          </div>

          {progress && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ height: 6, background: '#1a1a2e', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${(progress.completed / progress.total) * 100}%`,
                  background: '#66ddaa', transition: 'width 120ms linear',
                }} />
              </div>
              <div style={{ color: '#888', fontSize: 10, marginTop: 4 }}>{progress.completed} / {progress.total} rounds</div>
            </div>
          )}

          {error && <div style={{ color: '#ff8888', fontSize: 12, marginBottom: 16 }}>{error}</div>}

          {result && <ResultView result={result} classA={sideA.class} classB={sideB.class} />}
        </>
      )}
    </div>
  );
}

function SideConfigPanel({ label, config, onChange }: {
  label: string;
  config: SideConfig;
  onChange: (c: SideConfig) => void;
}) {
  const color = CLASS_COLORS[config.class];
  const options = equippableSpells(config.class);

  function setClass(wizardClass: WizardClass) {
    onChange({ class: wizardClass, loadout: defaultLoadout(wizardClass) });
  }

  function setSlot(slot: number, spellId: string | null) {
    const next = [...config.loadout];
    next[slot] = spellId;
    onChange({ ...config, loadout: next });
  }

  return (
    <div style={{ flex: 1, border: `1px solid ${color}33`, borderRadius: 4, padding: 12 }}>
      <div style={{ color, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      <select value={config.class} onChange={(e) => setClass(e.target.value as WizardClass)} style={{ ...selectStyle, width: '100%', marginBottom: 8 }}>
        {CLASSES.map((c: string) => <option key={c} value={c}>{c}</option>)}
      </select>
      {[0, 1, 2, 3].map((slot) => (
        <select
          key={slot}
          value={config.loadout[slot] ?? ''}
          onChange={(e) => setSlot(slot, e.target.value || null)}
          style={{ ...selectStyle, width: '100%', marginBottom: 4 }}
        >
          <option value="">— empty —</option>
          {options.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ))}
    </div>
  );
}

function ResultView({ result, classA, classB }: { result: SimulationResult; classA: WizardClass; classB: WizardClass }) {
  const winA = result.winRateByClass[classA] ?? 0;
  const winB = result.winRateByClass[classB] ?? 0;

  const spellRows = Object.entries(result.damageBySpell)
    .sort((a, b) => b[1].totalDamage - a[1].totalDamage)
    .slice(0, 12);

  return (
    <div>
      <div style={{ color: '#aaa', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>
        Results — {result.rounds} rounds, {result.draws} draw{result.draws !== 1 ? 's' : ''}
        {result.avgTimeToKillMs != null && <span style={{ marginLeft: 12, color: '#666' }}>avg TTK {(result.avgTimeToKillMs / 1000).toFixed(1)}s</span>}
      </div>

      <WinRateBar label={classA} color={CLASS_COLORS[classA]} value={winA} />
      <WinRateBar label={classB} color={CLASS_COLORS[classB]} value={winB} />

      <div style={{ color: '#aaa', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', margin: '18px 0 8px' }}>
        Damage by spell
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {spellRows.map(([spellId, stats]) => (
          <div key={spellId} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #1a1a28' }}>
            <span style={{ color: '#ccc', fontSize: 11 }}>{spellId}</span>
            <span style={{ color: '#888', fontSize: 11 }}>
              {stats.totalDamage.toLocaleString()} dmg · {stats.hits} hits
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WinRateBar({ label, color, value }: { label: string; color: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ color, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</span>
        <span style={{ color: '#ccc', fontSize: 11 }}>{pct}%</span>
      </div>
      <div style={{ height: 10, background: '#14141f', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 5, transition: 'width 200ms ease' }} />
      </div>
    </div>
  );
}

const selectStyle = {
  background: '#0c0c16', border: '1px solid #333', borderRadius: 3, color: '#ddd',
  fontSize: 11, padding: '5px 6px', fontFamily: "'Courier New', monospace",
} as const;
