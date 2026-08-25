/**
 * Small Gandalf-pipe flourish for the landing screen: a stylised wizard
 * silhouette with a pipe, and a handful of CSS-animated smoke puffs
 * drifting up and fading. A literal smoke-into-carriage shape morph was
 * scoped out as too high-fidelity for this pass -- this is the lighter
 * "ambient wisps" version.
 */

const PUFFS = [
  { delay: 0,    drift: -8,  size: 22, top: 46, left: 74 },
  { delay: 900,  drift: 10,  size: 28, top: 44, left: 76 },
  { delay: 1800, drift: -14, size: 20, top: 47, left: 73 },
  { delay: 2700, drift: 6,   size: 30, top: 45, left: 77 },
];

export function PipeSmoke() {
  return (
    <div style={{ position: 'absolute', width: 220, height: 260, pointerEvents: 'none' }}>
      <style>{`
        @keyframes pipeSmokeRise {
          0%   { transform: translate(0, 0) scale(0.4); opacity: 0; }
          15%  { opacity: 0.5; }
          100% { transform: translate(var(--drift, 0px), -140px) scale(1.6); opacity: 0; }
        }
      `}</style>

      {/* Wizard silhouette: cone hat + robe, same chunky-primitive look as the in-game wizard model */}
      <svg width="220" height="260" viewBox="0 0 220 260" style={{ position: 'absolute', inset: 0 }}>
        <polygon points="82,66 128,66 138,10 72,10" fill="#12121c" />
        <circle cx="105" cy="78" r="16" fill="#1a1a26" />
        <path d="M70 260 L60 130 Q60 92 105 92 Q150 92 150 130 L140 260 Z" fill="#12121c" />
        {/* Pipe: stem + bowl, angled out from where the mouth would be */}
        <rect x="118" y="80" width="26" height="6" rx="2" fill="#3a2a1a" transform="rotate(-8 118 80)" />
        <rect x="140" y="72" width="10" height="14" rx="2" fill="#3a2a1a" />
      </svg>

      {PUFFS.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: `${p.top}%`,
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(220,220,235,0.55) 0%, rgba(220,220,235,0) 70%)',
            filter: 'blur(2px)',
            animation: `pipeSmokeRise 4.2s ease-out ${p.delay}ms infinite`,
            ['--drift' as string]: `${p.drift}px`,
          }}
        />
      ))}
    </div>
  );
}
