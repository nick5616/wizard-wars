import { useEffect, useState } from 'react';
import { useNetworkStore } from '../../stores/networkStore';
import { netDebug } from '../../networking/netDebug';
import { BODY_FONT } from '../../styles/fonts';

/**
 * CS2-style net-graph corner readout: ping (RTT) and jitter (GAME_TICK
 * inter-arrival variance, see WebSocketClient._dispatch). Always visible;
 * escalates color once a value crosses into "notice this" territory.
 */
const PING_WARN = 100, PING_BAD = 200;
const JITTER_WARN = 10, JITTER_BAD = 25;

function statColor(value: number, warn: number, bad: number) {
  if (value >= bad) return '#ff5555';
  if (value >= warn) return '#ffcc44';
  return '#88cc88';
}

export function NetworkStats() {
  const { rtt, jitter, connected } = useNetworkStore();

  // Dev-only prediction/interpolation health (see networking/netDebug.ts);
  // netDebug.live isn't reactive, so poll it at a readable rate.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!netDebug.enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);
  const live = netDebug.live;

  return (
    <div style={{
      position: 'fixed',
      top: 34,
      left: 12,
      fontFamily: BODY_FONT,
      fontSize: 12,
      letterSpacing: 1,
      pointerEvents: 'none',
      zIndex: 100,
      display: 'flex',
      gap: 10,
      background: 'rgba(6,6,16,0.55)',
      padding: '3px 7px',
      borderRadius: 2,
    }}>
      <span style={{ color: statColor(rtt, PING_WARN, PING_BAD) }}>
        PING {Math.round(rtt)}ms
      </span>
      <span style={{ color: statColor(jitter, JITTER_WARN, JITTER_BAD) }}>
        JITTER {Math.round(jitter)}ms
      </span>
      {!connected && <span style={{ color: '#ff5555' }}>RECONNECTING</span>}
      {netDebug.enabled && (
        <span style={{ color: statColor(live.corrP95 * 100, 2, 10) }}>
          CORR {(live.corrMean * 100).toFixed(1)}/{(live.corrP95 * 100).toFixed(1)}cm {live.corrPerSec.toFixed(1)}/s
          {' '}UNACK {live.unacked} INTERP {Math.round(live.interpDelay)}ms X{live.extrapPct.toFixed(0)}% S{live.starvedPct.toFixed(0)}%
        </span>
      )}
    </div>
  );
}
