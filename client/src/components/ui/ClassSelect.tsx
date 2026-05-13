import { useState, useEffect } from 'react';
import type { WizardClass } from '../../types/game.types';
import { C2S } from 'shared/events';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import { UIButton } from './UIButton';

interface ClassSelectProps {
  ws: WebSocketClient;
  onSelected: (c: WizardClass) => void;
}

const CLASSES: { id: WizardClass; name: string; tagline: string; playstyle: string; difficulty: string; color: string; symbol: string }[] = [
  { id: 'fire',  name: 'Fire',  symbol: '🔥', tagline: 'Passionate. Aggressive. Loud.',       playstyle: 'High damage, escalating pressure. Some self-risk.', difficulty: 'Medium',    color: '#ff4500' },
  { id: 'ice',   name: 'Ice',   symbol: '❄️', tagline: 'Cunning. Precise. Final.',             playstyle: 'Control-heavy. Punishes aggression. Glass cannon burst.', difficulty: 'High',      color: '#a0d8ff' },
  { id: 'dark',  name: 'Dark',  symbol: '🌑', tagline: 'Chaotic. Self-loving. Unempathetic.',  playstyle: 'Asymmetric and theatrical. Highest ceiling.', difficulty: 'Very High', color: '#cc00ff' },
  { id: 'sword', name: 'Sword', symbol: '⚔️', tagline: 'Sovereign. Disciplined. Certain.',    playstyle: 'Clean hits, parry-based. Razor margin.',              difficulty: 'High',      color: '#c8c8c8' },
  { id: 'earth', name: 'Earth', symbol: '🌍', tagline: 'Ancient. Calm. Immovable.',           playstyle: 'Zone control, defense. Devastating payoff.',           difficulty: 'Medium',    color: '#8B6914' },
];

export function ClassSelect({ ws, onSelected }: ClassSelectProps) {
  const [hovered, setHovered] = useState<WizardClass | null>(null);

  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);

  function select(c: WizardClass) {
    ws.send(C2S.SELECT_CLASS, { class: c });
    onSelected(c);
  }

  const hoveredClass = CLASSES.find(c => c.id === hovered);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#050508',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 300,
      fontFamily: "'Courier New', monospace",
    }}>
      <div style={{ color: '#ccccdd', letterSpacing: 8, fontSize: 14, marginBottom: 8, textTransform: 'uppercase' }}>
        Choose Your Class
      </div>
      <div style={{ color: '#888', fontSize: 13, marginBottom: 48, letterSpacing: 2 }}>
        Your choice is permanent for this life
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 48 }}>
        {CLASSES.map((c) => (
          <UIButton
            key={c.id}
            onMouseEnter={() => setHovered(c.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => select(c.id)}
            locksPointer
            style={{
              width: 120,
              height: 160,
              background: hovered === c.id ? `${c.color}22` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${hovered === c.id ? c.color : '#222'}`,
              borderRadius: 2,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'all 0.2s',
              color: hovered === c.id ? c.color : '#999',
              boxShadow: hovered === c.id ? `0 0 20px ${c.color}22` : 'none',
              fontFamily: "'Courier New', monospace",
            }}
          >
            <div style={{ fontSize: 28 }}>{c.symbol}</div>
            <div style={{ fontSize: 14, letterSpacing: 2, textTransform: 'uppercase' }}>{c.name}</div>
            <div style={{ fontSize: 12, color: hovered === c.id ? `${c.color}cc` : '#777', letterSpacing: 1 }}>
              {c.difficulty}
            </div>
          </UIButton>
        ))}
      </div>

      {/* Class description */}
      <div style={{
        height: 80,
        width: 640,
        textAlign: 'center',
        color: hoveredClass ? '#ccccdd' : '#777',
        fontSize: 14,
        lineHeight: 1.8,
        letterSpacing: 1,
        transition: 'color 0.2s',
      }}>
        {hoveredClass ? (
          <>
            <div style={{ color: hoveredClass.color, marginBottom: 6, fontSize: 15 }}>{hoveredClass.tagline}</div>
            <div>{hoveredClass.playstyle}</div>
          </>
        ) : (
          <div>Hover to preview</div>
        )}
      </div>
    </div>
  );
}
