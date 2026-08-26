import { UIButton } from './UIButton';
import { GAME_MODES, GAME_MODE_ORDER } from 'shared/gameModes';
import { TITLE_FONT, BODY_FONT } from '../../styles/fonts';

interface GameMode {
  id: string;
  label: string;
  description: string;
  teamSizes: number[];
}

const MODES = GAME_MODES as Record<string, GameMode>;

interface ModeSelectProps {
  onPick: (modeId: string) => void;
  onBack: () => void;
}


/** Single Player: pick a bot game mode before heading into class select. */
export function ModeSelect({ onPick, onBack }: ModeSelectProps) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#050508',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 36,
      zIndex: 300,
      fontFamily: BODY_FONT,
    }}>
      <div style={{
        fontFamily: TITLE_FONT,
        fontWeight: 700,
        fontSize: 40,
        letterSpacing: 3,
        color: '#e8dcb8',
      }}>
        Choose Your Battle
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 920 }}>
        {GAME_MODE_ORDER.map((id: string) => {
          const mode = MODES[id];
          const teamCount = mode.teamSizes.length;
          const allEqual = mode.teamSizes.every((n) => n === mode.teamSizes[0]);
          const composition = id === 'duel1v1'
            ? 'Choose your rival'
            : allEqual
              ? `${teamCount} team${teamCount > 1 ? 's' : ''} of ${mode.teamSizes[0]}`
              : mode.teamSizes.join(' vs ');

          return (
            <UIButton
              key={id}
              onClick={() => onPick(id)}
              style={{
                width: 200,
                padding: '22px 16px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid #3a3528',
                borderRadius: 4,
                color: '#cfc39a',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.2s',
              }}
            >
              <div style={{ fontFamily: TITLE_FONT, fontSize: 22, letterSpacing: 1, color: '#e8dcb8' }}>
                {mode.label}
              </div>
              <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#9a8f6a' }}>
                {composition}
              </div>
              <div style={{ fontSize: 12, color: '#9a9080', textAlign: 'center', marginTop: 4 }}>
                {mode.description}
              </div>
            </UIButton>
          );
        })}
      </div>

      <UIButton
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          color: '#8a8065',
          fontSize: 13,
          letterSpacing: 2,
          textTransform: 'uppercase',
          cursor: 'pointer',
          fontFamily: BODY_FONT,
        }}
      >
        ← Back
      </UIButton>
    </div>
  );
}
