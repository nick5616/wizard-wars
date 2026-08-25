import { useGameStore, type MatchResultPlayer } from '../../stores/gameStore';
import { useNetworkStore } from '../../stores/networkStore';
import { C2S } from 'shared/events';
import { UIButton } from './UIButton';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import type { WizardClass } from '../../types/game.types';

interface MatchEndScreenProps {
  ws: WebSocketClient;
}

const TITLE_FONT = "'Cinzel Decorative', serif";
const BODY_FONT = "'MedievalSharp', cursive";

const CLASS_COLORS: Record<WizardClass, string> = {
  fire: '#ff4500', ice: '#a0d8ff', dark: '#cc00ff', sword: '#c8c8c8', druid: '#5a9e3d', crystalmancer: '#8fd4ff',
};

const PLACE_STYLE = [
  { medal: '#ffd700', height: 132, label: '1st' },
  { medal: '#c0c0c0', height: 96, label: '2nd' },
  { medal: '#cd7f32', height: 66, label: '3rd' },
];
// Visual left-to-right order for a classic podium (tallest in the middle).
const PODIUM_LAYOUT = [1, 0, 2];

/** Shown when S2C.MATCH_END fires (see Room._maybeEndMatch) -- podium + damage standings for the single-player match. */
export function MatchEndScreen({ ws }: MatchEndScreenProps) {
  const local = useGameStore((s) => s.local);
  const matchResult = useGameStore((s) => s.matchResult);
  const localPlayerId = useNetworkStore((s) => s.localPlayerId);

  const winningTeam = matchResult?.winningTeam ?? null;
  const won = winningTeam !== null && winningTeam === local.team;
  const draw = winningTeam === null;

  const headline = draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEATED';
  const headlineColor = draw ? '#cccccc' : won ? '#66ddaa' : '#cc4444';

  const standings = matchResult?.standings ?? [];
  const players = matchResult?.players ?? [];

  const teamsByRank = standings.map((team, i) => ({
    team,
    place: i + 1,
    members: players.filter((p) => p.team === team),
  }));
  const podiumTeams = teamsByRank.slice(0, 3);
  const restTeams = teamsByRank.slice(3);

  // Everyone, ranked by team placement first and total damage dealt second.
  const teamRank = new Map<number | null, number>(standings.map((team, i) => [team, i]));
  const damageRanked = [...players].sort((a, b) => {
    const rankDiff = (teamRank.get(a.team) ?? 999) - (teamRank.get(b.team) ?? 999);
    return rankDiff !== 0 ? rankDiff : b.damageDealt - a.damageDealt;
  });

  function returnToMenu() {
    ws.send(C2S.LEAVE_ROOM, {});
    useGameStore.getState().setMatchResult(null);
    useGameStore.getState().setMatchActive(false);
    useGameStore.getState().setPhase('main_menu');
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.88)',
      zIndex: 400,
      fontFamily: BODY_FONT,
      overflowY: 'auto',
      padding: '40px 0',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, width: 'min(640px, 92vw)' }}>
        <div style={{
          fontFamily: TITLE_FONT,
          fontWeight: 900,
          fontSize: 52,
          letterSpacing: 6,
          color: headlineColor,
          textShadow: `0 0 28px ${headlineColor}66`,
        }}>
          {headline}
        </div>

        {/* Podium: top 3 teams, tallest stand in the middle */}
        {podiumTeams.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14 }}>
            {PODIUM_LAYOUT
              .filter((slot) => slot < podiumTeams.length)
              .map((slot) => {
                const entry = podiumTeams[slot];
                const style = PLACE_STYLE[slot];
                const isLocalTeam = entry.team === local.team;
                return (
                  <div key={entry.team} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 150 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                      {entry.members.map((m) => (
                        <div key={m.id} style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          fontSize: 12,
                          color: m.id === localPlayerId ? '#fff' : '#ccc',
                          fontWeight: m.id === localPlayerId ? 700 : 400,
                        }}>
                          <span style={{
                            width: 9, height: 9, borderRadius: '50%',
                            background: m.class ? CLASS_COLORS[m.class] : '#666',
                            display: 'inline-block',
                            boxShadow: m.id === localPlayerId ? '0 0 6px #fff' : 'none',
                          }} />
                          {m.username}
                        </div>
                      ))}
                    </div>
                    <div style={{
                      width: '100%',
                      height: style.height,
                      background: `linear-gradient(180deg, ${style.medal}33 0%, ${style.medal}11 100%)`,
                      border: `1px solid ${style.medal}`,
                      borderBottom: 'none',
                      borderRadius: '3px 3px 0 0',
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'center',
                      paddingTop: 10,
                      boxShadow: isLocalTeam ? `0 0 18px ${style.medal}55 inset` : 'none',
                    }}>
                      <div style={{ fontFamily: TITLE_FONT, fontSize: 24, fontWeight: 900, color: style.medal }}>
                        {style.label}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {/* Teams beyond 3rd place, if any (e.g. the 6-team mode) */}
        {restTeams.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
            {restTeams.map((entry) => (
              <div key={entry.team} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                fontSize: 12, color: '#999', padding: '4px 10px',
                border: '1px solid #2a2a2a', borderRadius: 3,
              }}>
                <span style={{ color: '#777', width: 32 }}>#{entry.place}</span>
                {entry.members.map((m) => m.username).join(', ')}
              </div>
            ))}
          </div>
        )}

        {/* Per-player damage standings */}
        <div style={{ width: '100%', border: '1px solid #2a2a2a', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '32px 1fr 90px 60px 90px',
            padding: '8px 12px', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase',
            color: '#777', background: 'rgba(255,255,255,0.03)',
          }}>
            <span>#</span><span>Wizard</span><span>Team</span><span>Kills</span><span>Damage</span>
          </div>
          {damageRanked.map((p, i) => (
            <div key={p.id} style={{
              display: 'grid', gridTemplateColumns: '32px 1fr 90px 60px 90px',
              padding: '7px 12px', fontSize: 13,
              color: p.id === localPlayerId ? '#fff' : '#bbb',
              background: p.id === localPlayerId ? 'rgba(255,255,255,0.05)' : 'transparent',
              borderTop: '1px solid #1e1e1e',
            }}>
              <span style={{ color: '#777' }}>{i + 1}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: p.class ? CLASS_COLORS[p.class] : '#666',
                  display: 'inline-block',
                }} />
                {p.username}
              </span>
              <span style={{ color: '#888' }}>{p.team === local.team ? 'Your Team' : `Team ${(teamRank.get(p.team) ?? 0) + 1}`}</span>
              <span>{p.kills}</span>
              <span>{p.damageDealt.toLocaleString()}</span>
            </div>
          ))}
        </div>

        <UIButton
          onClick={returnToMenu}
          style={{
            marginTop: 4,
            padding: '12px 28px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid #555',
            borderRadius: 4,
            color: '#e8dcb8',
            fontFamily: TITLE_FONT,
            fontSize: 16,
            letterSpacing: 1,
            cursor: 'pointer',
          }}
        >
          Return to Menu
        </UIButton>
      </div>
    </div>
  );
}
