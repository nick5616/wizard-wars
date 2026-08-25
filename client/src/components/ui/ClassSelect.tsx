import { useState, useEffect } from 'react';
import type { WizardClass } from '../../types/game.types';
import { C2S } from 'shared/events';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import { UIButton } from './UIButton';
import { useNetworkStore } from '../../stores/networkStore';
import { CLASS_SYMBOL, CLASS_LABEL, CLASS_FORK_GROUP, BRANCH_FLAVOR } from 'shared/classFlavor';
import { getTree, getForkPair } from 'shared/skillTrees';
import { CARD_FRAME_CLIP, DEFAULT_FRAME_CLIP } from '../../data/cardFrames';
import cardThemes from '../../data/spellCardThemes.json';

interface ClassSelectProps {
  ws: WebSocketClient;
  onSelected: (c: WizardClass) => void;
  // Set when arriving here from the Single Player mode picker (see
  // ModeSelect/App.tsx) -- when present, picking a class starts a private
  // bot match (C2S.START_MATCH) instead of joining the shared lobby.
  pendingMode?: string | null;
}

interface SchoolTheme { frame: string; cornerGlyph: string; patternSalt: number; }
const SCHOOLS = cardThemes.schools as Record<string, SchoolTheme>;

interface BranchFlavor { symbol: string; title: string; }
const BRANCH_FLAVOR_MAP = BRANCH_FLAVOR as unknown as Record<string, Record<string, BranchFlavor>>;

const CLASS_COLORS: Record<WizardClass, string> = {
  fire: '#ff4500', ice: '#a0d8ff', dark: '#cc00ff', sword: '#c8c8c8', druid: '#5a9e3d', crystalmancer: '#8fd4ff',
};

const CLASS_ORDER: { id: WizardClass; comingSoon?: boolean }[] = [
  { id: 'fire' },
  { id: 'ice' },
  { id: 'dark' },
  { id: 'sword' },
  { id: 'druid' },
  { id: 'crystalmancer' },
];

interface SkillNode { id: string; label: string; tier: number; prereqs: string[]; branch?: string; }

/** Walks forward from a fork node through single-prereq descendants -- stops at the first
 *  reconvergence node (multiple prereqs), which is exactly where the two branches meet back up. */
function branchChain(tree: SkillNode[], start: SkillNode): SkillNode[] {
  const chain = [start];
  let current = start;
  for (;;) {
    const next = tree.find((n) => n.prereqs.length === 1 && n.prereqs[0] === current.id);
    if (!next) break;
    chain.push(next);
    current = next;
  }
  return chain;
}

interface SpecCard { key: string; title: string; symbol: string; spellNames: string[]; }

/** The 3 save-slot cards for a class: its 2 named specs, plus a balanced/undecided path through the shared trunk. */
function specCardsFor(wizardClass: WizardClass): SpecCard[] {
  const tree = getTree(wizardClass) as SkillNode[];
  const forkGroup = CLASS_FORK_GROUP[wizardClass];
  const forkPair = getForkPair(wizardClass, forkGroup) as SkillNode[] | null;

  if (!forkPair) {
    return [{ key: 'balanced', title: CLASS_LABEL[wizardClass], symbol: CLASS_SYMBOL[wizardClass], spellNames: tree.map((n) => n.label) }];
  }

  const forkTier = forkPair[0].tier;
  const trunk = tree.filter((n) => n.tier < forkTier).map((n) => n.label);

  const specs = forkPair.map((node) => {
    const flavor = BRANCH_FLAVOR_MAP[forkGroup]?.[node.branch as string];
    return {
      key: node.branch as string,
      title: flavor?.title ?? node.label,
      symbol: flavor?.symbol ?? CLASS_SYMBOL[wizardClass],
      spellNames: branchChain(tree, node).map((n) => n.label),
    };
  });

  return [
    specs[0],
    { key: 'balanced', title: 'Balanced', symbol: CLASS_SYMBOL[wizardClass], spellNames: trunk },
    specs[1],
  ];
}

export function ClassSelect({ ws, onSelected, pendingMode }: ClassSelectProps) {
  const [selected, setSelected] = useState<WizardClass>('fire');
  const [name, setName] = useState(() => useNetworkStore.getState().restoredUsername ?? '');

  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);

  function select(c: WizardClass) {
    const trimmed = name.trim().slice(0, 20);
    if (pendingMode) {
      ws.send(C2S.START_MATCH, trimmed ? { mode: pendingMode, class: c, username: trimmed } : { mode: pendingMode, class: c });
    } else {
      ws.send(C2S.SELECT_CLASS, trimmed ? { class: c, username: trimmed } : { class: c });
    }
    onSelected(c);
  }

  const color = CLASS_COLORS[selected];
  const school = SCHOOLS[selected];
  const frameClip = school ? (CARD_FRAME_CLIP[school.frame] ?? DEFAULT_FRAME_CLIP) : DEFAULT_FRAME_CLIP;
  const cards = specCardsFor(selected);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#050508',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 300,
      fontFamily: "'Courier New', monospace",
    }}>
      <div style={{ color: '#ccccdd', letterSpacing: 8, fontSize: 14, marginBottom: 20, textTransform: 'uppercase' }}>
        Choose Your Class
      </div>

      {/* Class tabs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
        {CLASS_ORDER.map(({ id, comingSoon }) => {
          const active = selected === id;
          const c = CLASS_COLORS[id];
          return (
            <UIButton
              key={id}
              onClick={() => !comingSoon && setSelected(id)}
              disabled={comingSoon}
              style={{
                position: 'relative',
                width: 96,
                padding: '10px 8px',
                background: active ? `${c}22` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${active ? c : '#222'}`,
                borderRadius: 2,
                cursor: comingSoon ? 'not-allowed' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.2s',
                color: active ? c : '#999',
                fontFamily: "'Courier New', monospace",
                opacity: comingSoon ? 0.4 : 1,
              }}
            >
              <div style={{ fontSize: 20 }}>{CLASS_SYMBOL[id]}</div>
              <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>{CLASS_LABEL[id]}</div>
              {comingSoon && (
                <div style={{ fontSize: 8, letterSpacing: 1, color: '#ffcc00', textTransform: 'uppercase' }}>Soon</div>
              )}
            </UIButton>
          );
        })}
      </div>

      {/* 3 save-slot spec cards for the selected class */}
      <div style={{ display: 'flex', gap: 18, marginBottom: 32 }}>
        {cards.map((card) => (
          <UIButton
            key={card.key}
            onClick={() => select(selected)}
            locksPointer
            style={{
              position: 'relative', width: 168, height: 220, cursor: 'pointer', flexShrink: 0,
              background: 'none', border: 'none', padding: 0, font: 'inherit',
            }}
          >
            <div style={{ position: 'absolute', inset: 0, clipPath: frameClip, WebkitClipPath: frameClip, background: `${color}99` }} />
            <div style={{
              position: 'absolute', inset: 2, clipPath: frameClip, WebkitClipPath: frameClip,
              background: `linear-gradient(165deg, ${color}2a 0%, rgba(8,8,14,0.97) 55%)`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '18px 14px 14px',
            }}>
              <div style={{ fontSize: 26, marginBottom: 6 }}>{card.symbol}</div>
              <div style={{ fontSize: 13, color, letterSpacing: 1.5, textTransform: 'uppercase', textAlign: 'center', marginBottom: 2 }}>
                {card.title}
              </div>
              <div style={{ fontSize: 9, color: '#777', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
                {CLASS_LABEL[selected]}
              </div>
              <div style={{ width: '100%', height: 1, background: `${color}44`, marginBottom: 10 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
                {card.spellNames.slice(0, 7).map((spellName) => (
                  <div key={spellName} style={{ fontSize: 10.5, color: '#bbb', textAlign: 'center' }}>{spellName}</div>
                ))}
                {card.spellNames.length > 7 && (
                  <div style={{ fontSize: 9, color: '#666', textAlign: 'center', marginTop: 2 }}>
                    +{card.spellNames.length - 7} more
                  </div>
                )}
              </div>
            </div>
          </UIButton>
        ))}
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 20))}
        placeholder="Enter your name..."
        maxLength={20}
        style={{
          width: 280,
          padding: '10px 14px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid #333',
          borderRadius: 3,
          color: '#eee',
          fontSize: 13,
          letterSpacing: 1,
          textAlign: 'center',
          fontFamily: "'Courier New', monospace",
          outline: 'none',
        }}
      />
    </div>
  );
}
