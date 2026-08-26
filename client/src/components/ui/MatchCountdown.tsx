/**
 * "Get your footing" grace period shown right after spawning into any
 * single-player match (see Room._startCountdown / S2C.MATCH_COUNTDOWN) --
 * bots stay passive server-side for the same window (BotController.tick).
 * Mounted unconditionally in App.tsx like NotificationFeed; renders nothing
 * once matchCountdownEndsAt is null or has long since passed.
 */
import { useEffect, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { TITLE_FONT } from '../../styles/fonts';

const FIGHT_DISPLAY_MS = 700; // how long "FIGHT!" lingers after the countdown hits zero

export function MatchCountdown() {
  const endsAt = useGameStore((s) => s.matchCountdownEndsAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [endsAt]);

  if (endsAt == null) return null;
  const remaining = endsAt - now;
  if (remaining < -FIGHT_DISPLAY_MS) return null;

  const counting = remaining > 0;
  const text = counting ? String(Math.ceil(remaining / 1000)) : 'FIGHT!';
  const color = counting ? '#e8dcb8' : '#ff5555';

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
      zIndex: 180,
    }}>
      <div style={{
        fontFamily: TITLE_FONT,
        fontWeight: 900,
        fontSize: counting ? 96 : 72,
        letterSpacing: 6,
        color,
        textShadow: `0 0 30px ${color}88`,
      }}>
        {text}
      </div>
    </div>
  );
}
