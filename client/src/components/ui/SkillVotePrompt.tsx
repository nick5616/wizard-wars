import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { C2S } from 'shared/events';
import { getSpell } from 'shared/spells';
import { getNode } from 'shared/skillTrees';
import { classFlavor } from 'shared/classFlavor';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import { UIButton } from './UIButton';
import { audioManager } from '../../audio/AudioManager';

interface SkillVotePromptProps {
  ws: WebSocketClient;
}

const CLASS_COLORS: Record<string, string> = {
  fire: '#ff4500', ice: '#a0d8ff', dark: '#cc00ff', sword: '#c8c8c8', earth: '#8B6914',
};

// A permanent, once-per-life fork in the caster's skill tree (see
// shared/skillTrees.js's branchGroup/branch fields) is a big enough moment
// to earn a full takeover: the player is despawned server-side for its
// duration (Room.processInput's isChoosingBranch check / Room.applyDamage's
// invulnerability check), so the screen matches that with a real "the world
// stopped for this" presentation instead of a small corner prompt easy to
// miss mid-fight.
export function SkillVotePrompt({ ws }: SkillVotePromptProps) {
  const voteState = useGameStore((s) => s.voteState);
  const setVoteState = useGameStore((s) => s.setVoteState);
  const wizardClass = useGameStore((s) => s.local.class);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!voteState) return;
    // vote_open is already played by App.tsx's SKILL_VOTE_PROMPT handler.
    if (document.pointerLockElement) document.exitPointerLock();
    const interval = setInterval(() => forceTick((n) => n + 1), 100);
    return () => clearInterval(interval);
  }, [voteState]);

  function choose(id: string) {
    if (!voteState) return;
    ws.send(C2S.SKILL_VOTE_RESOLVE, { branchGroup: voteState.branchGroup, choice: id });
    audioManager.playSound('vote_select');
    setVoteState(null);
    setTimeout(() => {
      const canvas = document.querySelector('canvas');
      if (canvas && !document.pointerLockElement) canvas.requestPointerLock();
    }, 50);
  }

  useEffect(() => {
    if (!voteState) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'F1' && e.code !== 'F2') return;
      e.preventDefault();
      const idx = e.code === 'F1' ? 0 : 1;
      const current = useGameStore.getState().voteState;
      const choice = current?.options[idx]?.id;
      if (choice) choose(choice);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voteState, ws]);

  if (!voteState) return null;

  const remaining = Math.max(0, voteState.expiresAt - Date.now());
  const pct = voteState.totalMs > 0 ? Math.max(0, Math.min(1, remaining / voteState.totalMs)) : 0;
  const baseColor = (wizardClass && CLASS_COLORS[wizardClass]) ?? '#ffcc00';

  const panels = voteState.options.map((opt, i) => {
    const node = wizardClass ? getNode(wizardClass, opt.id) : null;
    const flavor = wizardClass ? classFlavor(wizardClass, node?.branchGroup ? { [node.branchGroup]: node.branch } : {}) : { symbol: '', title: opt.label };
    const color = getSpell(opt.id)?.color ?? baseColor;
    return { opt, i, flavor, color };
  });

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

      <div style={{ textAlign: 'center', marginBottom: 34, animation: 'wwv-rise 380ms ease-out' }}>
        <div
          style={{
            fontSize: 13,
            letterSpacing: 10,
            textTransform: 'uppercase',
            color: '#888',
            marginBottom: 10,
          }}
        >
          A path diverges
        </div>
        <div
          style={{
            fontSize: 30,
            letterSpacing: 4,
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
        <div style={{ fontSize: 12, color: '#cc6666', letterSpacing: 2, marginTop: 12 }}>
          This choice is permanent. There is no going back.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 28, alignItems: 'stretch' }}>
        {panels.map(({ opt, i, flavor, color }) => (
          <UIButton
            key={opt.id}
            onClick={() => choose(opt.id)}
            style={
              {
                width: 300,
                padding: '28px 22px',
                background: `linear-gradient(180deg, ${color}18, rgba(6,6,16,0.9))`,
                border: `1px solid ${color}88`,
                borderRadius: 8,
                cursor: 'pointer',
                textAlign: 'center',
                color: '#ddd',
                fontFamily: "'Courier New', monospace",
                animation: `wwv-rise 420ms ease-out ${i * 90}ms both, wwv-pulse-border 2.6s ease-in-out infinite`,
                '--wwv-glow': `${color}33`,
              } as CSSProperties
            }
          >
            <div style={{ fontSize: 34, marginBottom: 10 }}>{flavor.symbol}</div>
            <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: `${color}cc`, marginBottom: 4 }}>
              [F{i + 1}] {flavor.title}
            </div>
            <div style={{ fontSize: 17, color: '#fff', marginBottom: 12, letterSpacing: 1 }}>{opt.label}</div>
            <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.6 }}>{opt.description}</div>
          </UIButton>
        ))}
      </div>

      <div style={{ width: 628, height: 4, background: '#1a1a24', borderRadius: 2, overflow: 'hidden', marginTop: 34 }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: `linear-gradient(90deg, ${panels[0]?.color ?? baseColor}, ${panels[1]?.color ?? baseColor})`, transition: 'width 100ms linear' }} />
      </div>
      <div style={{ fontSize: 10, color: '#666', letterSpacing: 2, marginTop: 10, textTransform: 'uppercase' }}>
        Deciding automatically in {Math.ceil(remaining / 1000)}s
      </div>
    </div>
  );
}
