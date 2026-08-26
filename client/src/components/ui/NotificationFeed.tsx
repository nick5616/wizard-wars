import { useEffect } from 'react';
import { useGameStore, NOTIFICATION_TTL_MS } from '../../stores/gameStore';
import { BODY_FONT } from '../../styles/fonts';

// Cheap, low-graphics-cost event feed (auto-unlocks, auto-equips, level/rank
// ups, hat procs, denied casts, ...). Same age-fade/stacked-plain-div shape
// as KillFeed, anchored top-center so it doesn't collide with the kill feed
// (right) or the skill-tree vote prompt (left).
export function NotificationFeed() {
  const notifications = useGameStore((s) => s.notifications);

  // Fade (below) makes them invisible by TTL, but they'd otherwise sit in the
  // store/DOM forever as zero-opacity ghost boxes -- actually drop them once expired.
  useEffect(() => {
    const interval = setInterval(() => useGameStore.getState().pruneNotifications(), 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      position: 'fixed',
      top: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 4,
      pointerEvents: 'none',
      zIndex: 150,
    }}>
      {notifications.slice(0, 4).map((n) => {
        const age = Date.now() - n.at;
        const opacity = Math.max(0, 1 - age / NOTIFICATION_TTL_MS);
        return (
          <div key={n.id} style={{
            background: 'rgba(0,0,0,0.6)',
            border: `1px solid ${n.color}55`,
            borderRadius: 3,
            padding: '5px 12px',
            fontSize: 12,
            letterSpacing: 0.5,
            color: n.color,
            opacity,
            fontFamily: BODY_FONT,
            whiteSpace: 'nowrap',
          }}>
            {n.text}
          </div>
        );
      })}
    </div>
  );
}
