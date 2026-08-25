import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useGameStore } from '../../stores/gameStore';
import type { VoteState } from '../../stores/gameStore';
import { C2S } from 'shared/events';
import { getSpell } from 'shared/spells';
import { getNode } from 'shared/skillTrees';
import { classFlavor } from 'shared/classFlavor';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import { UIButton } from './UIButton';
import { audioManager } from '../../audio/AudioManager';
import { legibleAccent } from '../../utils/legibleColor';
import { SpellTypeIcon, iconKindForSpellId } from './SpellTypeIcon';

interface SkillVotePromptProps {
  ws: WebSocketClient;
}

const CLASS_COLORS: Record<string, string> = {
  fire: '#ff4500', ice: '#a0d8ff', dark: '#cc00ff', sword: '#c8c8c8', druid: '#5a9e3d', crystalmancer: '#8fd4ff',
};

const F_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'];

export function SkillVotePrompt({ ws }: SkillVotePromptProps) {
  const voteState = useGameStore((s) => s.voteState);
  const setVoteState = useGameStore((s) => s.setVoteState);

  function choose(id: string) {
    if (!voteState) return;
    ws.send(C2S.SKILL_VOTE_RESOLVE, { promptId: voteState.promptId, choice: id });
    audioManager.playSound('vote_select');
    setVoteState(null);
    if (voteState.blocking) {
      setTimeout(() => {
        const canvas = document.querySelector('canvas');
        if (canvas && !document.pointerLockElement) canvas.requestPointerLock();
      }, 50);
    }
  }

  useEffect(() => {
    if (!voteState) return;

    function onKeyDown(e: KeyboardEvent) {
      const idx = F_KEYS.indexOf(e.code);
      if (idx === -1) return;
      const current = useGameStore.getState().voteState;
      const choice = current?.options[idx]?.id;
      if (!choice) return;
      e.preventDefault();
      choose(choice);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voteState, ws]);

  if (!voteState) return null;
  return voteState.blocking
    ? <ForkChoiceScreen voteState={voteState} onChoose={choose} />
    : <PointSpendPrompt voteState={voteState} onChoose={choose} />;
}

interface Panel {
  id: string;
  i: number;
  flavor: { symbol: string; title: string };
  color: string;
  label: string;
  description: string;
  kind: ReturnType<typeof iconKindForSpellId>;
}

function buildPanels(voteState: { options: { id: string; label: string; description: string }[] }, baseColor: string): Panel[] {
  const wizardClass = useGameStore.getState().local.class;
  return voteState.options.map((opt, i) => {
    const node = wizardClass ? getNode(wizardClass, opt.id) : null;
    const flavor = wizardClass
      ? classFlavor(wizardClass, node?.branchGroup ? { [node.branchGroup]: node.branch } : {})
      : { symbol: '', title: opt.label };
    const spell = getSpell(opt.id);
    // Text/accent color, not the raw spell color -- some spells (Amaterasu's
    // "black fire") are deliberately near-black for their 3D effect, which
    // would be invisible as text on this UI's dark panels.
    const color = spell ? legibleAccent(spell.color, spell.glowColor) : baseColor;
    const kind = iconKindForSpellId(opt.id);
    return { id: opt.id, i, flavor, color, label: opt.label, description: opt.description, kind };
  });
}

// A permanent, once-per-life fork in the caster's skill tree (see
// shared/skillTrees.js's branchGroup/branch fields) is a big enough moment
// to earn a full takeover: the player is despawned server-side for its
// duration (Room.processInput's isChoosingBranch check / Room.applyDamage's
// invulnerability check), so the screen matches that with a real "the world
// stopped for this" presentation instead of a small corner prompt easy to
// miss mid-fight. No countdown here on purpose -- this is a permanent,
// once-per-life decision, and reading it under a ticking clock is the wrong
// feeling for it. (The server still has a long safety-net timeout in case
// someone walks away, but nothing about it is shown here.)
function ForkChoiceScreen({ voteState, onChoose }: { voteState: VoteState; onChoose: (id: string) => void }) {
  const wizardClass = useGameStore((s) => s.local.class);

  useEffect(() => {
    // vote_open is already played by App.tsx's SKILL_VOTE_PROMPT handler.
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);

  const baseColor = (wizardClass && CLASS_COLORS[wizardClass]) ?? '#ffcc00';
  const panels = buildPanels(voteState, baseColor);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 600,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Courier New', monospace",
        background: `radial-gradient(circle at 25% 50%, ${panels[0]?.color ?? baseColor}22, transparent 55%),
                     radial-gradient(circle at 75% 50%, ${panels[1]?.color ?? baseColor}22, transparent 55%),
                     rgba(2,2,8,0.97)`,
        animation: 'wwv-fadein 260ms ease-out',
      }}
    >
      <style>{`
        @keyframes wwv-fadein { from { opacity: 0; } to { opacity: 1; } }
        @keyframes wwv-rise { from { opacity: 0; transform: translateY(18px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes wwv-pulse-border { 0%, 100% { box-shadow: 0 0 18px var(--wwv-glow), inset 0 0 24px var(--wwv-glow); } 50% { box-shadow: 0 0 34px var(--wwv-glow), inset 0 0 40px var(--wwv-glow); } }
        @keyframes wwv-shimmer { 0% { background-position: 0% 0; } 100% { background-position: 200% 0; } }
      `}</style>

      <div style={{ textAlign: 'center', marginBottom: 40, animation: 'wwv-rise 380ms ease-out' }}>
        <div style={{ fontSize: 12, letterSpacing: 9, textTransform: 'uppercase', color: '#888', marginBottom: 12 }}>
          A path diverges
        </div>
        <div
          style={{
            fontSize: 42,
            fontWeight: 'bold',
            letterSpacing: 5,
            textTransform: 'uppercase',
            backgroundImage: `linear-gradient(90deg, ${panels[0]?.color ?? baseColor}, #fff, ${panels[1]?.color ?? baseColor}, #fff, ${panels[0]?.color ?? baseColor})`,
            backgroundSize: '200% auto',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            animation: 'wwv-shimmer 4s linear infinite',
          }}
        >
          Choose Your Path
        </div>
        <div style={{ fontSize: 12, color: '#cc6666', letterSpacing: 2, marginTop: 14 }}>
          This choice is permanent. There is no going back. Take your time.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 28, alignItems: 'stretch' }}>
        {panels.map(({ id, i, flavor, color, label, description, kind }) => (
          <UIButton
            key={id}
            onClick={() => onChoose(id)}
            style={
              {
                position: 'relative',
                width: 320,
                padding: '30px 24px 26px',
                background: `linear-gradient(180deg, ${color}18, rgba(6,6,16,0.9))`,
                border: `1px solid ${color}88`,
                borderRadius: 8,
                cursor: 'pointer',
                textAlign: 'left',
                color: '#ddd',
                fontFamily: "'Courier New', monospace",
                animation: `wwv-rise 420ms ease-out ${i * 90}ms both, wwv-pulse-border 2.6s ease-in-out infinite`,
                '--wwv-glow': `${color}33`,
              } as CSSProperties
            }
          >
            <div style={{
              position: 'absolute', top: 10, left: 12,
              fontSize: 10, letterSpacing: 1, color: `${color}aa`,
              border: `1px solid ${color}55`, borderRadius: 3, padding: '2px 6px',
            }}>
              F{i + 1}
            </div>

            <div style={{ fontSize: 38, marginBottom: 12 }}>{flavor.symbol}</div>

            {/* High-level title: the identity this choice commits you to -- the largest, most important text in the panel. */}
            <div style={{ fontSize: 25, color: '#fff', letterSpacing: 1, marginBottom: 8, lineHeight: 1.2 }}>
              {flavor.title}
            </div>

            {/* Supporting detail: the specific spell this unlocks first. */}
            <div style={{
              display: 'inline-block',
              fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
              color: `${color}cc`, marginBottom: 8,
              border: `1px solid ${color}44`, borderRadius: 3, padding: '3px 9px',
            }}>
              {label}
            </div>

            {/* Passive vs. spell, and what kind of spell -- not just a name. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 12, color: '#888' }}>
              <SpellTypeIcon kind={kind} size={11} color="#888" />
              <span style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>{kind}</span>
            </div>

            <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.6 }}>{description}</div>
          </UIButton>
        ))}
      </div>
    </div>
  );
}

// An ordinary skill point with more than one legal place to spend it (e.g.
// several spells becoming available at the same tier at once) -- unlike the
// fork above, none of these choices foreclose the others: pick one now, the
// rest stay available for your next point. Deliberately NOT a takeover: no
// despawn, no freeze, no timeout. If you ignore it, the point just stays
// banked -- it never spends itself for you, and it never demands attention.
function PointSpendPrompt({ voteState, onChoose }: { voteState: VoteState; onChoose: (id: string) => void }) {
  const wizardClass = useGameStore((s) => s.local.class);
  const skillPoints = useGameStore((s) => s.local.skillPoints);
  const baseColor = (wizardClass && CLASS_COLORS[wizardClass]) ?? '#ffcc00';
  const panels = buildPanels(voteState, baseColor);
  // Every node currently costs exactly 1 point to unlock (see
  // ProgressionSystem._unlockNode) -- shown per-option so the cost is
  // explicit rather than assumed, in case that ever stops being uniform.
  const pointCost = 1;

  return (
    <div style={{
      position: 'fixed',
      left: 20,
      bottom: 178, // sits just above the HP/Level/Mana well cluster (see StatusWells)
      width: 300,
      zIndex: 160,
      fontFamily: "'Courier New', monospace",
      background: 'rgba(6,6,16,0.94)',
      border: `1px solid ${baseColor}55`,
      borderRadius: 6,
      padding: 14,
      boxShadow: `0 0 16px ${baseColor}22`,
    }}>
      <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: baseColor, marginBottom: 10 }}>
        You have {skillPoints} skill point{skillPoints === 1 ? '' : 's'} to spend
      </div>

      {panels.map(({ id, i, color, label, description, kind }) => (
        <UIButton
          key={id}
          onClick={() => onChoose(id)}
          style={{
            position: 'relative',
            display: 'block',
            width: '100%',
            padding: '7px 9px',
            marginBottom: 6,
            background: `${color}0f`,
            border: `1px solid ${color}55`,
            borderRadius: 4,
            cursor: 'pointer',
            textAlign: 'left',
            fontFamily: "'Courier New', monospace",
          }}
        >
          <span style={{
            position: 'absolute', top: 6, right: 8,
            fontSize: 9, color: `${color}cc`,
            border: `1px solid ${color}55`, borderRadius: 3, padding: '1px 4px',
          }}>
            {pointCost} pt
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, paddingRight: 34 }}>
            <span style={{ fontSize: 9, color: `${color}cc`, border: `1px solid ${color}55`, borderRadius: 3, padding: '1px 4px' }}>F{i + 1}</span>
            <span style={{ fontSize: 12, color: '#eee' }}>{label}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3, color: '#888' }}>
            <SpellTypeIcon kind={kind} size={10} color="#888" />
            <span style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase' }}>{kind}</span>
          </div>
          <div style={{ fontSize: 10, color: '#999', lineHeight: 1.4 }}>{description}</div>
        </UIButton>
      ))}
    </div>
  );
}
