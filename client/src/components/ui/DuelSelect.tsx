import { useNetworkStore } from '../../stores/networkStore';
import { UIButton } from './UIButton';
import { DUEL_OPPONENTS } from 'shared/duelOpponents';
import { CLASS_LABEL, CLASS_SYMBOL } from 'shared/classFlavor';
import { TITLE_FONT, BODY_FONT } from '../../styles/fonts';
import type { WizardClass } from '../../types/game.types';

interface DuelOpponent {
  id: string;
  name: string;
  class: WizardClass;
  behavior: 'static' | 'docile' | 'aggressive';
  spellCount: number;
  elo: number;
}

const CLASS_COLORS: Record<WizardClass, string> = {
  fire: '#ff4500', ice: '#a0d8ff', dark: '#cc00ff', sword: '#c8c8c8', druid: '#5a9e3d', crystalmancer: '#8fd4ff',
};

const DUEL_K = 32; // mirrors Room.js's DUEL_ELO_K -- display-only, the server is authoritative

interface DuelSelectProps {
  onPick: (opponentId: string) => void;
  onBack: () => void;
}

/** Single Player 1v1: pick a named opponent and stake your reputation (ELO) on the outcome. */
export function DuelSelect({ onPick, onBack }: DuelSelectProps) {
  const myElo = useNetworkStore((s) => s.elo);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#050508',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 28,
      zIndex: 300,
      fontFamily: BODY_FONT,
      padding: '40px 0',
      overflowY: 'auto',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: TITLE_FONT, fontWeight: 700, fontSize: 36, letterSpacing: 3, color: '#e8dcb8' }}>
          Choose Your Rival
        </div>
        <div style={{ marginTop: 6, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: '#9a8f6a' }}>
          Your rating: {myElo}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 220px)', gap: 16, maxWidth: 760 }}>
        {(DUEL_OPPONENTS as DuelOpponent[]).map((opp) => {
          const color = CLASS_COLORS[opp.class];
          const expected = 1 / (1 + Math.pow(10, (opp.elo - myElo) / 400));
          const winPct = Math.round(expected * 100);
          const gain = Math.max(1, Math.round(DUEL_K * (1 - expected)));
          const loss = Math.max(1, Math.round(DUEL_K * expected));

          return (
            <UIButton
              key={opp.id}
              onClick={() => onPick(opp.id)}
              style={{
                padding: '16px 14px',
                background: `${color}0d`,
                border: `1px solid ${color}55`,
                borderRadius: 4,
                color: '#cfc39a',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.2s',
              }}
            >
              <div style={{ fontSize: 22 }}>{CLASS_SYMBOL[opp.class]}</div>
              <div style={{ fontFamily: TITLE_FONT, fontSize: 15, color: '#e8dcb8', textAlign: 'center' }}>
                {opp.name}
              </div>
              <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color }}>
                {CLASS_LABEL[opp.class]}
              </div>
              <div style={{ width: '100%', height: 1, background: `${color}33`, margin: '4px 0' }} />
              <div style={{ fontSize: 11, color: '#9a9080' }}>Rating {opp.elo}</div>
              <div style={{ fontSize: 11, color: '#9a9080' }}>Predicted win: {winPct}%</div>
              <div style={{ fontSize: 11, marginTop: 2 }}>
                <span style={{ color: '#66ddaa' }}>+{gain} win</span>
                {' · '}
                <span style={{ color: '#cc6666' }}>-{loss} lose</span>
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
