import { useEffect, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { C2S } from 'shared/events';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import { audioManager } from '../../audio/AudioManager';

interface SkillVotePromptProps {
  ws: WebSocketClient;
}

// Counterstrike-style vote prompt for the one genuine fork in a class's
// skill tree. Anchored left so it never competes with the killfeed (right)
// or notifications (top-center). Does NOT block gameplay -- you keep
// playing while it's up, same as a CS map vote.
export function SkillVotePrompt({ ws }: SkillVotePromptProps) {
  const voteState = useGameStore((s) => s.voteState);
  const setVoteState = useGameStore((s) => s.setVoteState);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!voteState) return;
    const interval = setInterval(() => forceTick((n) => n + 1), 100);
    return () => clearInterval(interval);
  }, [voteState]);

  useEffect(() => {
    if (!voteState) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'F1' && e.code !== 'F2') return;
      e.preventDefault();
      const idx = e.code === 'F1' ? 0 : 1;
      const current = useGameStore.getState().voteState;
      const choice = current?.options[idx]?.id;
      if (!current || !choice) return;
      ws.send(C2S.SKILL_VOTE_RESOLVE, { branchGroup: current.branchGroup, choice });
      audioManager.playSound('vote_select');
      setVoteState(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [voteState, ws, setVoteState]);

  if (!voteState) return null;

  const remaining = Math.max(0, voteState.expiresAt - Date.now());
  const pct = voteState.totalMs > 0 ? Math.max(0, Math.min(1, remaining / voteState.totalMs)) : 0;

  return (
    <div style={{
      position: 'fixed',
      left: 20,
      top: '40%',
      transform: 'translateY(-50%)',
      width: 280,
      background: 'rgba(6,6,16,0.95)',
      border: '1px solid #333',
      borderRadius: 6,
      padding: 16,
      zIndex: 350,
      fontFamily: "'Courier New', monospace",
      color: '#ccc',
    }}>
      <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: '#ffcc00', marginBottom: 10 }}>
        Choose your path
      </div>

      {voteState.options.map((opt, i) => (
        <div key={opt.id} style={{
          padding: '8px 10px',
          marginBottom: 8,
          border: '1px solid #333',
          borderRadius: 4,
          background: 'rgba(255,255,255,0.03)',
        }}>
          <div style={{ fontSize: 11, color: '#ffcc00', marginBottom: 3, letterSpacing: 1 }}>
            [F{i + 1}] {opt.label}
          </div>
          <div style={{ fontSize: 10, color: '#999', lineHeight: 1.4 }}>{opt.description}</div>
        </div>
      ))}

      <div style={{ height: 3, background: '#222', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: '#ffcc00' }} />
      </div>
    </div>
  );
}
