import { useGameStore } from '../../stores/gameStore';
import { useNetworkStore } from '../../stores/networkStore';

// Domains are whole-arena ultimates with real mechanical effects (see
// Room._domainSpeedMultiplier / _applyDomainPull / tickProjectiles), but
// previously the only on-screen sign one was active was a fog tint -- a
// slow/pull/accel effect with zero UI attribution just reads as "nothing
// happened" (or "the game lagged"). This banner spells out what's live and
// whether the local player is actually affected by it.
const DOMAIN_INFO: Record<string, { name: string; effect: string; affectsOwner: boolean; affectsOthers: boolean; color: string }> = {
  inferno_domain: { name: 'Inferno Domain', effect: 'All projectiles accelerate toward their target.', affectsOwner: true, affectsOthers: true, color: '#ff5500' },
  absolute_zero: { name: 'Absolute Zero', effect: 'Near-total stillness. You are frozen in place.', affectsOwner: false, affectsOthers: true, color: '#88ccff' },
  event_horizon: { name: 'Event Horizon', effect: 'Gravity pulls everyone and everything toward center.', affectsOwner: true, affectsOthers: true, color: '#aa00ff' },
  the_last_word: { name: 'The Last Word', effect: 'Time crawls. You move at a fraction of normal speed.', affectsOwner: false, affectsOthers: true, color: '#cccccc' },
  terra_domain: { name: 'Terra Domain', effect: 'Stone spires erupt at random. Movement is slowed.', affectsOwner: false, affectsOthers: true, color: '#aa7722' },
};

export function DomainBanner() {
  const domains = useGameStore((s) => s.domains);
  const { localPlayerId } = useNetworkStore();

  const domain = Object.values(domains).find((d) => d.active);
  if (!domain) return null;

  const info = DOMAIN_INFO[domain.spellId];
  if (!info) return null;

  const now = Date.now();
  const telegraphing = now < domain.activatesAt;
  const isOwner = domain.ownerId === localPlayerId;
  const affectsMe = isOwner ? info.affectsOwner : info.affectsOthers;
  const glowColor = info.color;

  const total = telegraphing ? domain.activatesAt - domain.startedAt : domain.expiresAt - domain.activatesAt;
  const elapsed = telegraphing ? now - domain.startedAt : now - domain.activatesAt;
  const pct = total > 0 ? Math.max(0, Math.min(1, elapsed / total)) : 0;

  return (
    <div style={{
      position: 'fixed',
      top: 96,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
      pointerEvents: 'none',
      zIndex: 140,
      fontFamily: "'Courier New', monospace",
    }}>
      <div style={{
        background: 'rgba(4,4,10,0.82)',
        border: `1px solid ${glowColor}88`,
        borderRadius: 5,
        padding: '10px 22px',
        textAlign: 'center',
        boxShadow: `0 0 22px ${glowColor}33`,
      }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: telegraphing ? '#ffcc00' : glowColor, marginBottom: 4 }}>
          {telegraphing ? 'Domain Incoming' : (isOwner ? 'Your Domain Active' : (affectsMe ? 'Domain Active — You Are Affected' : 'Domain Active'))}
        </div>
        <div style={{ fontSize: 15, color: '#fff', letterSpacing: 1, marginBottom: 3 }}>{info.name}</div>
        <div style={{ fontSize: 11, color: '#bbb' }}>{info.effect}</div>
        {!telegraphing && !affectsMe && (
          <div style={{ fontSize: 10, color: '#66ddaa', marginTop: 4, letterSpacing: 1 }}>You are immune.</div>
        )}
      </div>
      <div style={{ width: 220, height: 3, background: '#1a1a24', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: glowColor }} />
      </div>
    </div>
  );
}
