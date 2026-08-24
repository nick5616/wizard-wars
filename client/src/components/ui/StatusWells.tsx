/**
 * Bottom-left HUD cluster: three circular "well" gauges (HP red, Level
 * green, Mana blue) instead of the old stacked bars -- which is also what
 * fixes the old layout bug where the XP bar and health bar's text sat right
 * on top of each other once the spell cards grew taller. Player name and
 * class sit right below the cluster (class moved here from the old top-right
 * corner badge).
 */

import type { CSSProperties } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { classFlavor } from 'shared/classFlavor';
import { xpProgress } from 'shared/leveling';

const ROMAN_TABLE: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

function toRoman(n: number): string {
  let remaining = Math.max(1, Math.floor(n));
  let out = '';
  for (const [value, symbol] of ROMAN_TABLE) {
    while (remaining >= value) {
      out += symbol;
      remaining -= value;
    }
  }
  return out;
}

interface WellProps {
  size: number;
  pct: number; // 0..1, fills bottom-up
  color: string;
  glow: string;
  label?: string;
  value: string;
  style: CSSProperties;
}

function Well({ size, pct, color, glow, label, value, style }: WellProps) {
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <div style={{
      position: 'absolute', width: size, height: size, borderRadius: '50%',
      background: '#0a0a12',
      border: `2px solid ${color}`,
      boxShadow: `0 0 10px ${glow}77, inset 0 0 12px rgba(0,0,0,0.7)`,
      overflow: 'hidden',
      ...style,
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        clipPath: `inset(${(1 - clamped) * 100}% 0% 0% 0%)`,
        transition: 'clip-path 0.15s ease',
        background: `linear-gradient(180deg, ${glow} 0%, ${color} 100%)`,
        opacity: 0.8,
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        {label && (
          <div style={{
            fontSize: Math.max(7, size * 0.14), letterSpacing: 1, color: '#fff', opacity: 0.8,
            textShadow: '0 1px 2px #000', textTransform: 'uppercase',
          }}>
            {label}
          </div>
        )}
        <div style={{ fontSize: Math.max(11, size * 0.22), fontWeight: 'bold', color: '#fff', textShadow: '0 1px 3px #000', lineHeight: 1 }}>
          {value}
        </div>
      </div>
    </div>
  );
}

export function StatusWells() {
  const local = useGameStore((s) => s.local);
  const { level, fraction } = xpProgress(local.xp);
  const flavor = local.class ? classFlavor(local.class, local.divergedBranch) : null;

  const hpPct = local.maxHealth > 0 ? local.health / local.maxHealth : 0;
  const manaPct = local.maxMana > 0 ? local.mana / local.maxMana : 0;

  return (
    <>
      <div style={{ position: 'fixed', left: 20, bottom: 56, width: 176, height: 116, pointerEvents: 'none', zIndex: 100 }}>
        <Well size={92} pct={hpPct} color="#dd2222" glow="#ff5555" label="HP" value={`${Math.ceil(local.health)}`} style={{ left: 26, bottom: 0 }} />
        <Well size={30} pct={fraction} color="#22aa55" glow="#66ff99" value={toRoman(level)} style={{ left: 8, top: 6 }} />
        <Well size={54} pct={manaPct} color="#2266dd" glow="#66aaff" label="MANA" value={`${Math.round(local.mana)}`} style={{ right: 24, top: 16 }} />
      </div>

      {/* Player name + class, below the well cluster */}
      <div style={{
        position: 'fixed', left: 20, bottom: 22, width: 176, textAlign: 'center',
        pointerEvents: 'none', zIndex: 100,
      }}>
        {local.username && (
          <div style={{ fontSize: 12, color: '#ddd', letterSpacing: 1, textShadow: '0 1px 2px #000', marginBottom: 2 }}>
            {local.username}
          </div>
        )}
        {flavor && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            fontSize: 11, color: '#999', textTransform: 'uppercase', letterSpacing: 2,
            textShadow: '0 1px 2px #000',
          }}>
            <span style={{ fontSize: 13 }}>{flavor.symbol}</span>
            <span>{flavor.title}</span>
          </div>
        )}
      </div>
    </>
  );
}
