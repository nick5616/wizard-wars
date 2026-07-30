import { useEffect } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { C2S } from 'shared/events';
import { rankForLevel } from 'shared/leveling';
import { getForkPair } from 'shared/skillTrees';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import type { WizardClass } from '../../types/game.types';
import { audioManager } from '../../audio/AudioManager';

interface DeathScreenProps {
  ws: WebSocketClient;
}

const CLASS_OPTIONS: { id: WizardClass; label: string; color: string; key: string }[] = [
  { id: 'fire', label: 'Fire', color: '#ff4500', key: '1' },
  { id: 'ice', label: 'Ice', color: '#a0d8ff', key: '2' },
  { id: 'dark', label: 'Dark', color: '#cc00ff', key: '3' },
  { id: 'sword', label: 'Sword', color: '#c8c8c8', key: '4' },
  { id: 'earth', label: 'Earth', color: '#8B6914', key: '5' },
];

// Mounted directly in App.tsx (gated on phase === 'dead'), not nested inside
// HUD -- HUD bails out as soon as phase leaves 'playing', which is exactly
// what makes the old inline "DEFEATED" block dead code the instant death
// actually happens.
export function DeathScreen({ ws }: DeathScreenProps) {
  const local = useGameStore((s) => s.local);
  const rank = rankForLevel(local.level);

  const branchGroup = local.class ? Object.keys(local.divergedBranch)[0] : undefined;
  const pair = local.class && branchGroup ? getForkPair(local.class, branchGroup) : null;
  const currentBranch = branchGroup ? local.divergedBranch[branchGroup] : undefined;
  const otherOption = pair?.find((n: { branch?: string }) => n.branch !== currentBranch) as
    | { id: string; label: string; branch?: string }
    | undefined;

  useEffect(() => {
    audioManager.playSound('death_screen_open');
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Leave Escape/Tab alone -- App.tsx uses them to open the pause/skill menus
      // even while dead, and those shouldn't also trigger a respawn.
      if (e.code === 'Escape' || e.code === 'Tab') return;
      if (useGameStore.getState().menuOpen) return;

      const key = e.key.toLowerCase();
      const classOpt = CLASS_OPTIONS.find((c) => c.key === key);
      audioManager.playSound('respawn_confirm');
      if (classOpt) {
        ws.send(C2S.RESPAWN, { newClass: classOpt.id });
        return;
      }
      if (key === 'b' && otherOption) {
        ws.send(C2S.RESPAWN, { switchBranch: true });
        return;
      }
      ws.send(C2S.RESPAWN, {});
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ws, otherOption]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 14,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 200,
        fontFamily: "'Courier New', monospace",
      }}
      onClick={() => ws.send(C2S.RESPAWN, {})}
    >
      <div style={{ fontSize: 34, color: '#cc0000', letterSpacing: 6 }}>DEFEATED</div>
      <div style={{ fontSize: 14, color: '#999', letterSpacing: 2, textTransform: 'uppercase' }}>
        {rank.name} · Level {local.level}
      </div>

      <div style={{ fontSize: 13, color: '#ccc', marginTop: 18, letterSpacing: 1 }}>
        Press any key to respawn as <span style={{ color: '#eee' }}>{local.class}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {CLASS_OPTIONS.filter((c) => c.id !== local.class).map((c) => (
          <div
            key={c.id}
            style={{
              padding: '6px 10px',
              border: `1px solid ${c.color}66`,
              borderRadius: 3,
              color: c.color,
              fontSize: 11,
              letterSpacing: 1,
            }}
          >
            [{c.key}] {c.label}
          </div>
        ))}
      </div>

      {otherOption && (
        <div style={{
          marginTop: 12,
          fontSize: 12,
          color: '#ffcc00',
          border: '1px solid #ffcc0055',
          borderRadius: 3,
          padding: '6px 12px',
          letterSpacing: 1,
        }}>
          [B] Try {otherOption.label} instead
        </div>
      )}
    </div>
  );
}
