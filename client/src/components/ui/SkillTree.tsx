import { useState, useEffect } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { C2S } from 'shared/events';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import { ALL_SPELLS } from 'shared/spells';
import { SKILL_TREES as SHARED_SKILL_TREES } from 'shared/skillTrees';
import type { WizardClass } from '../../types/game.types';
import { UIButton } from './UIButton';
import { SpellTypeGlyph, iconKindForSpellId } from './SpellTypeIcon';

interface SkillNode {
  id: string;
  label: string;
  type: 'spell' | 'passive';
  tier: number;
  x: number;
  prereqs: string[];
  description: string;
  branchGroup?: string;
  branch?: string;
  shouldReplace?: string;
}

const SKILL_TREES = SHARED_SKILL_TREES as Record<WizardClass, SkillNode[]>;

interface SkillTreeProps {
  ws: WebSocketClient;
  onClose: () => void;
}

const CLASS_COLORS: Record<WizardClass, string> = {
  fire: '#ff4500', ice: '#a0d8ff', dark: '#cc00ff', sword: '#c8c8c8', earth: '#8B6914',
};

export function SkillTree({ ws, onClose }: SkillTreeProps) {
  const { local, addUnlockedNode, debugMode } = useGameStore();
  const wizardClass = local.class;
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);

  if (!wizardClass) return null;

  const tree = SKILL_TREES[wizardClass];
  const color = CLASS_COLORS[wizardClass];
  const unlocked = new Set(local.unlockedNodes);

  const maxTier = Math.max(...tree.map(n => n.tier));
  const TIER_H = 48;
  const SVG_W = 480;
  const SVG_H = (maxTier + 1) * TIER_H;

  // Normal play auto-spends skill points the instant they're available (see
  // ProgressionSystem.tryAutoUnlock) -- manual purchase only exists for
  // debug mode. Without this gate a player could hand-pick either side of
  // the F1/F2 fork straight from this UI, skipping the vote entirely.
  function canBuy(node: SkillNode): boolean {
    if (unlocked.has(node.id)) return false;
    if (!debugMode) return false;
    return true;
  }

  function buy(node: SkillNode) {
    if (!canBuy(node)) return;
    ws.send(C2S.BUY_SKILL_NODE, { nodeId: node.id });
    addUnlockedNode(node.id);
  }

  const hovered = tree.find(n => n.id === hoveredNode);
  const hoveredSpell = hovered ? (ALL_SPELLS as Record<string, typeof ALL_SPELLS[keyof typeof ALL_SPELLS]>)[hovered.id] ?? null : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 400,
        fontFamily: "'Courier New', monospace",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
          setTimeout(() => {
            const canvas = document.querySelector('canvas');
            if (canvas && !document.pointerLockElement) canvas.requestPointerLock();
          }, 50);
        }
      }}
    >
      <div style={{
        display: 'flex',
        gap: 0,
        background: 'rgba(6,6,16,0.98)',
        border: `1px solid ${color}33`,
        borderRadius: 6,
        overflow: 'hidden',
        maxHeight: '88vh',
        width: 820,
      }}>

        {/* ── Left: description panel ─────────────────────────────────── */}
        <div style={{
          width: 280,
          flexShrink: 0,
          borderRight: `1px solid #1a1a2e`,
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 20px',
        }}>
          {/* Header */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ color: color, fontSize: 11, letterSpacing: 5, textTransform: 'uppercase', marginBottom: 4 }}>
              {wizardClass} — Skill Tree
            </div>
            <div style={{ color: '#aaa', fontSize: 11, letterSpacing: 2 }}>
              {local.skillPoints} point{local.skillPoints !== 1 ? 's' : ''} available
              {debugMode && <span style={{ color: '#ff8844', marginLeft: 8 }}>DEBUG</span>}
            </div>
          </div>

          {/* Node info */}
          {hovered ? (
            <div style={{ flex: 1 }}>
              {/* Type badge */}
              <div style={{ marginBottom: 10 }}>
                <span style={{
                  fontSize: 9,
                  letterSpacing: 3,
                  textTransform: 'uppercase',
                  padding: '2px 7px',
                  borderRadius: 2,
                  background: hovered.type === 'spell' ? `${color}22` : '#1a1a2e',
                  border: `1px solid ${hovered.type === 'spell' ? color + '55' : '#333'}`,
                  color: hovered.type === 'spell' ? color : '#888',
                }}>
                  {hovered.type}
                </span>
              </div>

              {/* Name */}
              <div style={{
                color: unlocked.has(hovered.id) ? color : canBuy(hovered) ? '#ccddff' : '#aaa',
                fontSize: 17,
                fontWeight: 'bold',
                marginBottom: 10,
                letterSpacing: 1,
                lineHeight: 1.2,
              }}>
                {hovered.label}
              </div>

              {/* Description */}
              <div style={{ color: '#999', fontSize: 12, lineHeight: 1.7, marginBottom: 16 }}>
                {hovered.description}
              </div>

              {/* Spell stats if applicable */}
              {hoveredSpell && (
                <div style={{
                  background: '#0a0a18',
                  border: '1px solid #1a1a2e',
                  borderRadius: 4,
                  padding: '10px 12px',
                  marginBottom: 14,
                  fontSize: 11,
                  lineHeight: 1.9,
                }}>
                  {hoveredSpell.damage > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#888' }}>damage</span>
                      <span style={{ color: '#ddd' }}>{hoveredSpell.damage}</span>
                    </div>
                  )}
                  {hoveredSpell.cooldown > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#888' }}>cooldown</span>
                      <span style={{ color: hoveredSpell.cooldown < 0.3 ? '#44ff88' : '#ddd' }}>
                        {hoveredSpell.cooldown}s
                        {hoveredSpell.cooldown < 0.3 ? ' ⚡' : ''}
                      </span>
                    </div>
                  )}
                  {hoveredSpell.speed && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#888' }}>speed</span>
                      <span style={{ color: '#ddd' }}>{hoveredSpell.speed}</span>
                    </div>
                  )}
                  {hoveredSpell.statusEffect && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#888' }}>applies</span>
                      <span style={{ color: '#aa88ff' }}>{hoveredSpell.statusEffect}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#888' }}>type</span>
                    <span style={{ color: '#bbb' }}>{hoveredSpell.type}</span>
                  </div>
                </div>
              )}

              {/* Prereqs */}
              {hovered.prereqs.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ color: '#888', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 5 }}>
                    requires
                  </div>
                  {hovered.prereqs.map(pid => {
                    const pNode = tree.find(n => n.id === pid);
                    return (
                      <div key={pid} style={{
                        fontSize: 11,
                        color: unlocked.has(pid) ? color : '#888',
                        marginBottom: 3,
                        paddingLeft: 8,
                        borderLeft: `2px solid ${unlocked.has(pid) ? color : '#444'}`,
                      }}>
                        {pNode?.label ?? pid}
                        {unlocked.has(pid) ? ' ✓' : ''}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Buy button / status */}
              {unlocked.has(hovered.id) ? (
                <div style={{ color: color, fontSize: 11, letterSpacing: 2 }}>✓ Unlocked</div>
              ) : canBuy(hovered) ? (
                <UIButton
                  onClick={() => buy(hovered)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: `${color}22`,
                    border: `1px solid ${color}88`,
                    borderRadius: 3,
                    color,
                    fontSize: 11,
                    letterSpacing: 3,
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                  }}
                >
                  Unlock — 1 point
                </UIButton>
              ) : (
                <div style={{ color: '#888', fontSize: 11, letterSpacing: 1 }}>
                  {debugMode
                    ? 'Prerequisites not met'
                    : 'Unlocks itself automatically once earned'}
                </div>
              )}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
              <div style={{ color: '#555', fontSize: 28, marginBottom: 12 }}>◇</div>
              <div style={{ color: '#888', fontSize: 12, textAlign: 'center', lineHeight: 1.6 }}>
                Hover a node<br />to preview
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{ color: '#666', fontSize: 10, letterSpacing: 2, marginTop: 16, paddingTop: 12, borderTop: '1px solid #222' }}>
            Tab or click outside to close
          </div>
        </div>

        {/* ── Right: tree SVG ─────────────────────────────────────────── */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 20px',
        }}>
          <svg width={SVG_W} height={SVG_H} style={{ overflow: 'visible', display: 'block' }}>
            {/* Connection lines */}
            {tree.map(node =>
              node.prereqs.map(prereqId => {
                const prereq = tree.find(n => n.id === prereqId);
                if (!prereq) return null;
                const x1 = prereq.x * SVG_W, y1 = prereq.tier * TIER_H;
                const x2 = node.x * SVG_W,   y2 = node.tier * TIER_H;
                const isActive = unlocked.has(prereqId) && unlocked.has(node.id);
                return (
                  <line key={`${prereqId}-${node.id}`}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={isActive ? color : '#444'}
                    strokeWidth={isActive ? 2 : 1}
                    strokeOpacity={isActive ? 0.7 : 0.8}
                  />
                );
              })
            )}

            {/* Nodes */}
            {tree.map(node => {
              const x = node.x * SVG_W;
              const y = node.tier * TIER_H;
              const bought    = unlocked.has(node.id);
              const buyable   = canBuy(node);
              const isHovered = hoveredNode === node.id;

              const nodeColor = bought ? color : buyable ? '#5588aa' : '#666';
              const textColor = bought ? color : buyable ? '#bbddff' : '#999';

              return (
                <g key={node.id}
                  transform={`translate(${x}, ${y})`}
                  style={{ cursor: buyable ? 'pointer' : 'default' }}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  onClick={() => buy(node)}
                >
                  <circle
                    r={isHovered ? 14 : 11}
                    fill={bought ? `${color}22` : isHovered ? '#1a1a2e' : '#050508'}
                    stroke={nodeColor}
                    strokeWidth={isHovered ? 2 : 1.5}
                    style={{ transition: 'all 0.12s' }}
                  />
                  <svg
                    x={isHovered ? -8 : -6.5} y={isHovered ? -8 : -6.5}
                    width={isHovered ? 16 : 13} height={isHovered ? 16 : 13}
                    viewBox="0 0 24 24" fill="none" stroke={textColor} strokeWidth={2}
                    strokeLinecap="round" strokeLinejoin="round"
                  >
                    <SpellTypeGlyph kind={iconKindForSpellId(node.id)} />
                  </svg>
                  <text textAnchor="middle" dy={26} fontSize={9} fill={textColor} style={{ userSelect: 'none' }}>
                    {node.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
