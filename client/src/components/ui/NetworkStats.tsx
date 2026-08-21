import { useNetworkStore } from '../../stores/networkStore';

/**
 * CS2-style net-graph corner readout: ping (RTT) and jitter (GAME_TICK
 * inter-arrival variance, see WebSocketClient._dispatch). Stays hidden on a
 * healthy connection -- only appears once one of the two crosses into
 * "notice this" territory, and escalates color at a second, worse threshold.
 */
const PING_WARN = 100, PING_BAD = 200;
const JITTER_WARN = 10, JITTER_BAD = 25;

function statColor(value: number, warn: number, bad: number) {
  if (value >= bad) return '#ff5555';
  if (value >= warn) return '#ffcc44';
  return '#88cc88';
}

export function NetworkStats() {
  const { rtt, jitter } = useNetworkStore();

  const pingHigh = rtt >= PING_WARN;
  const jitterHigh = jitter >= JITTER_WARN;
  if (!pingHigh && !jitterHigh) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 34,
      left: 12,
      fontFamily: "'Courier New', monospace",
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
    </div>
  );
}
