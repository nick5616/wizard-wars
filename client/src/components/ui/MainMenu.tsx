import { useState } from 'react';
import { UIButton } from './UIButton';
import { MenuBattleBackdrop } from './MenuBattleBackdrop';
import { PipeSmoke } from './PipeSmoke';

interface MainMenuProps {
  onSinglePlayer: () => void;
  onMultiplayer: () => void;
}

const TITLE_FONT = "'Cinzel Decorative', serif";
const BODY_FONT = "'MedievalSharp', cursive";

/**
 * Landing screen. Two wizards trade spells behind the title (a fantasy
 * riff on the classic COD-menu-soldiers trick, via MenuBattleBackdrop), a
 * pipe-smoke flourish in the corner, and the Single Player / Multiplayer
 * choice front and center.
 */
export function MainMenu({ onSinglePlayer, onMultiplayer }: MainMenuProps) {
  const [hovered, setHovered] = useState<'sp' | 'mp' | null>(null);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#050508',
      overflow: 'hidden',
      zIndex: 300,
      fontFamily: BODY_FONT,
    }}>
      {/* Two wizards trading spells, dimmed behind a vignette so the text stays legible */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.55 }}>
        <MenuBattleBackdrop />
      </div>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse at 50% 40%, rgba(5,5,8,0.35) 0%, rgba(5,5,8,0.92) 72%)',
      }} />

      <div style={{ position: 'absolute', bottom: 24, left: 24 }}>
        <PipeSmoke />
      </div>

      <div style={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 44,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: TITLE_FONT,
            fontWeight: 900,
            fontSize: 84,
            letterSpacing: 4,
            color: '#e8dcb8',
            textShadow: '0 0 24px rgba(180,150,80,0.45), 0 4px 0 rgba(0,0,0,0.6)',
          }}>
            Wizard Wars
          </div>
          <div style={{
            marginTop: 10,
            fontSize: 15,
            letterSpacing: 6,
            textTransform: 'uppercase',
            color: '#9a8f6a',
          }}>
            Gather your spells. Choose your fight.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24 }}>
          <MenuButton label="Single Player" active={hovered === 'sp'}
            onMouseEnter={() => setHovered('sp')} onMouseLeave={() => setHovered(null)}
            onClick={onSinglePlayer} />
          <MenuButton label="Multiplayer" active={hovered === 'mp'}
            onMouseEnter={() => setHovered('mp')} onMouseLeave={() => setHovered(null)}
            onClick={onMultiplayer} />
        </div>
      </div>
    </div>
  );
}

interface MenuButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function MenuButton({ label, active, onClick, onMouseEnter, onMouseLeave }: MenuButtonProps) {
  return (
    <UIButton
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        width: 260,
        padding: '18px 20px',
        background: active ? 'rgba(180,150,80,0.16)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${active ? '#c9b073' : '#3a3528'}`,
        borderRadius: 4,
        color: active ? '#f0e2b8' : '#cfc39a',
        fontFamily: TITLE_FONT,
        fontSize: 22,
        letterSpacing: 2,
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
    >
      {label}
    </UIButton>
  );
}
