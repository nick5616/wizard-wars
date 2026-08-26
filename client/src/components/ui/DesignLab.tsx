/**
 * Localhost-only card design workbench, sibling to the Experiment Lab.
 *
 * The problem it exists to solve: late game the hotbar holds a dozen-plus
 * spells and a tier-1 starter looked exactly as important as a capstone.
 * Card looks are now parameterised (data/cardRecipe.ts) and generated
 * (utils/cardRecipeGen.ts), which means they can be produced in bulk,
 * browsed, and picked -- rather than hand-authored one at a time.
 *
 * Three tabs:
 *   Generate -- roll a wall of candidate looks, filtered by theme and power
 *               band. Click one to inspect its parameters, bank it, or put
 *               it on a spell.
 *   Bank     -- every look kept for later, including ones not yet used.
 *   Spells   -- every spell in the game as it currently renders, so you can
 *               see the actual power ramp and spot the ones that read wrong.
 *
 * Picks apply live (localStorage) and are written back to
 * data/cardRecipeBank.json via the server on "Save to repo".
 */

import { useMemo, useState } from 'react';
import { ALL_SPELLS } from 'shared/spells';
import { CLASSES } from 'shared/constants';
import { C2S } from 'shared/events';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import type { SpellDef, WizardClass } from '../../types/game.types';
import { UIButton } from './UIButton';
import { SpellCard } from './SpellCard';
import { useCardRecipeStore, recipeFor } from '../../stores/cardRecipeStore';
import { generateBatch, generateRecipe, THEME_LIST, SCHOOL_THEME, type ThemeId } from '../../utils/cardRecipeGen';
import { rarityForGrade, type CardRecipe } from '../../data/cardRecipe';
import { seedFromString } from '../../utils/cardSeed';
import { BODY_FONT } from '../../styles/fonts';

const ACCENT = '#b98cff';

const SPELL_LIST = Object.values(ALL_SPELLS) as SpellDef[];

/** A spell to borrow colours from when previewing a look that isn't on a spell yet. */
function sampleSpellFor(theme: ThemeId | 'all'): SpellDef {
  const school = Object.keys(SCHOOL_THEME).find((s) => SCHOOL_THEME[s] === theme);
  const pool = school ? SPELL_LIST.filter((s) => s.school === school) : SPELL_LIST;
  // Mid-tier: its colours are usually the most representative of the school.
  const sorted = [...pool].sort((a, b) => a.tier - b.tier);
  return sorted[Math.floor(sorted.length / 2)] ?? SPELL_LIST[0];
}

interface Props {
  ws: WebSocketClient;
  onClose: () => void;
}

type Tab = 'generate' | 'bank' | 'spells';

export function DesignLab({ ws, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('generate');
  const bank = useCardRecipeStore((s) => s.bank);
  const assignments = useCardRecipeStore((s) => s.assignments);
  const resetLocal = useCardRecipeStore((s) => s.resetLocal);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  function saveToRepo() {
    setSaveState('saving');
    ws.send(C2S.SAVE_CARD_RECIPES, { bank, assignments });
    // The server writes the file and doesn't send a dedicated ack -- the
    // useful signal is the file on disk, and localStorage already holds the
    // same state, so a timed confirmation is honest enough here.
    setTimeout(() => setSaveState('saved'), 400);
    setTimeout(() => setSaveState('idle'), 2600);
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 600, fontFamily: BODY_FONT,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 'min(1180px, 94vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        background: 'rgba(6,6,16,0.98)', border: `1px solid ${ACCENT}44`, borderRadius: 6, overflow: 'hidden',
      }}>
        <div style={{ padding: '18px 24px 12px', borderBottom: '1px solid #252535', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: ACCENT, fontSize: 11, letterSpacing: 5, textTransform: 'uppercase' }}>Design Lab</div>
            <div style={{ color: '#888', fontSize: 10, letterSpacing: 1, marginTop: 3 }}>
              localhost only — {Object.keys(bank).length} in bank, {Object.keys(assignments).length} assigned
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <UIButton onClick={resetLocal} style={btn('#553', '#cc9')}>Reset local</UIButton>
            <UIButton onClick={saveToRepo} style={btn('#2a6b2a', '#8fdb8f')}>
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save to repo'}
            </UIButton>
            <UIButton onClick={onClose} locksPointer style={btn('#444', '#ccc')}>ESC</UIButton>
          </div>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid #252535' }}>
          {(['generate', 'bank', 'spells'] as Tab[]).map((t) => (
            <UIButton
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, background: 'none', border: 'none',
                borderBottom: tab === t ? `2px solid ${ACCENT}` : '2px solid transparent',
                color: tab === t ? ACCENT : '#aaa',
                fontSize: 11, letterSpacing: 3, padding: '10px 0', cursor: 'pointer', textTransform: 'uppercase',
              }}
            >
              {t}
            </UIButton>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
          {tab === 'generate' && <GenerateTab />}
          {tab === 'bank' && <BankTab />}
          {tab === 'spells' && <SpellsTab />}
        </div>
      </div>
    </div>
  );
}

// ─── Generate ──────────────────────────────────────────────────────────────

const GRADE_BANDS: { label: string; range: [number, number] }[] = [
  { label: 'full ramp', range: [0, 1] },
  { label: 'starter', range: [0, 0.3] },
  { label: 'mid', range: [0.3, 0.65] },
  { label: 'late', range: [0.62, 0.88] },
  { label: 'capstone', range: [0.85, 1] },
];

function GenerateTab() {
  const [theme, setTheme] = useState<ThemeId | 'all'>('all');
  const [bandIdx, setBandIdx] = useState(0);
  const [count, setCount] = useState(48);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [selected, setSelected] = useState<CardRecipe | null>(null);
  const [paletteSpellId, setPaletteSpellId] = useState<string>('');

  const paletteSpell = useMemo(
    () => SPELL_LIST.find((s) => s.id === paletteSpellId) ?? sampleSpellFor(theme),
    [paletteSpellId, theme],
  );

  const recipes = useMemo(() => {
    const band = GRADE_BANDS[bandIdx].range;
    if (theme !== 'all') return generateBatch({ count, seed, theme, gradeRange: band });
    // "All themes" interleaves the themes rather than sampling randomly, so
    // one roll shows the whole vocabulary instead of five glacial cards in a row.
    const per = Math.ceil(count / THEME_LIST.length);
    return THEME_LIST
      .flatMap((t, i) => generateBatch({ count: per, seed: seed + i * 104729, theme: t.id, gradeRange: band }))
      .slice(0, count);
  }, [theme, bandIdx, count, seed]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <Field label="Theme">
          <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeId | 'all')} style={selectStyle}>
            <option value="all">all themes</option>
            {THEME_LIST.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Power band">
          <select value={bandIdx} onChange={(e) => setBandIdx(Number(e.target.value))} style={selectStyle}>
            {GRADE_BANDS.map((b, i) => <option key={b.label} value={i}>{b.label}</option>)}
          </select>
        </Field>
        <Field label="Count">
          <select value={count} onChange={(e) => setCount(Number(e.target.value))} style={selectStyle}>
            {[24, 48, 96, 160].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Colors from">
          <select value={paletteSpellId} onChange={(e) => setPaletteSpellId(e.target.value)} style={{ ...selectStyle, maxWidth: 190 }}>
            <option value="">auto (by theme)</option>
            {CLASSES.map((c: string) => (
              <optgroup key={c} label={c}>
                {SPELL_LIST.filter((s) => s.class === c).sort((a, b) => a.tier - b.tier).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <UIButton
          onClick={() => { setSeed(Math.floor(Math.random() * 1e9)); setSelected(null); }}
          style={{ ...btn(ACCENT + '66', ACCENT), padding: '6px 14px', alignSelf: 'flex-end' }}
        >
          Reroll
        </UIButton>
        <div style={{ color: '#666', fontSize: 10, alignSelf: 'flex-end', paddingBottom: 5 }}>
          seed {seed.toString(36)}
        </div>
      </div>

      {selected && (
        <RecipeInspector
          recipe={selected}
          spell={paletteSpell}
          onClose={() => setSelected(null)}
          onMutate={(r) => setSelected(r)}
        />
      )}

      <CardGrid>
        {recipes.map((r) => (
          <CardTile
            key={r.id}
            recipe={r}
            spell={paletteSpell}
            selected={selected?.id === r.id}
            onClick={() => setSelected(selected?.id === r.id ? null : r)}
          />
        ))}
      </CardGrid>
    </div>
  );
}

// ─── Bank ──────────────────────────────────────────────────────────────────

function BankTab() {
  const bank = useCardRecipeStore((s) => s.bank);
  const removeFromBank = useCardRecipeStore((s) => s.removeFromBank);
  const entries = Object.values(bank).sort((a, b) => b.recipe.grade - a.recipe.grade);
  const [selected, setSelected] = useState<CardRecipe | null>(null);

  if (entries.length === 0) {
    return (
      <div style={{ color: '#666', fontSize: 12, fontStyle: 'italic', padding: '30px 0', textAlign: 'center' }}>
        Nothing banked yet. Roll some looks in Generate and hit “Save to bank” on the ones worth keeping.
      </div>
    );
  }

  return (
    <div>
      {selected && (
        <RecipeInspector
          recipe={selected}
          spell={sampleSpellFor('all')}
          onClose={() => setSelected(null)}
          onMutate={(r) => setSelected(r)}
        />
      )}
      <CardGrid>
        {entries.map(({ recipe, assigned }) => {
          // Preview a banked look in the colours of whatever it's on, if
          // anything -- that's the version that actually ships.
          const owner = assigned?.[0] ? SPELL_LIST.find((s) => s.id === assigned[0]) : undefined;
          const preview = owner ?? sampleSpellFor('all');
          return (
            <CardTile
              key={recipe.id}
              recipe={recipe}
              spell={preview}
              selected={selected?.id === recipe.id}
              onClick={() => setSelected(selected?.id === recipe.id ? null : recipe)}
              footer={
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                  {assigned && assigned.length > 0 && (
                    <div style={{ color: '#7fd', fontSize: 9 }}>
                      → {assigned.map((id) => SPELL_LIST.find((s) => s.id === id)?.name ?? id).join(', ')}
                    </div>
                  )}
                  <UIButton
                    onClick={() => { removeFromBank(recipe.id); if (selected?.id === recipe.id) setSelected(null); }}
                    style={{ ...btn('#6b2a2a', '#db8f8f'), fontSize: 9, padding: '2px 6px' }}
                  >
                    Remove
                  </UIButton>
                </div>
              }
            />
          );
        })}
      </CardGrid>
    </div>
  );
}

// ─── Spells ────────────────────────────────────────────────────────────────

function SpellsTab() {
  const assignments = useCardRecipeStore((s) => s.assignments);
  const bank = useCardRecipeStore((s) => s.bank);
  const unassign = useCardRecipeStore((s) => s.unassign);
  const [wizardClass, setWizardClass] = useState<WizardClass>('fire');

  const spells = useMemo(
    () => SPELL_LIST.filter((s) => s.class === wizardClass).sort((a, b) => a.tier - b.tier),
    [wizardClass],
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        {CLASSES.map((c: string) => (
          <UIButton
            key={c}
            onClick={() => setWizardClass(c as WizardClass)}
            style={{
              ...btn(wizardClass === c ? ACCENT : '#333', wizardClass === c ? ACCENT : '#999'),
              textTransform: 'uppercase', padding: '4px 12px',
            }}
          >
            {c}
          </UIButton>
        ))}
      </div>
      <div style={{ color: '#666', fontSize: 10, marginBottom: 14 }}>
        Sorted by tier — this row is the power ramp as a player actually sees it. Anything that reads
        louder than its neighbours to the right is the thing to re-pick.
      </div>

      <CardGrid>
        {spells.map((spell) => {
          const assignedId = assignments[spell.id];
          const recipe = assignedId && bank[assignedId]
            ? bank[assignedId].recipe
            : recipeFor(spell.id, spell.school, spell.class, spell.tier);
          const rarity = rarityForGrade(recipe.grade);
          return (
            <div key={spell.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              <SpellCard
                spellId={spell.id}
                spell={spell}
                slotLabel=""
                cooldownSec={0}
                cooldownPct={0}
                width={92}
                height={120}
                forceLit
              />
              <div style={{ color: '#ccc', fontSize: 10, textAlign: 'center' }}>{spell.name}</div>
              <div style={{ color: rarity.gem, fontSize: 9, letterSpacing: 1 }}>
                T{spell.tier} · {rarity.label}
              </div>
              {assignedId ? (
                <UIButton onClick={() => unassign(spell.id)} style={{ ...btn('#553', '#cc9'), fontSize: 9, padding: '2px 6px' }}>
                  custom — revert
                </UIButton>
              ) : (
                <div style={{ color: '#555', fontSize: 9 }}>generated</div>
              )}
            </div>
          );
        })}
      </CardGrid>
    </div>
  );
}

// ─── Shared pieces ─────────────────────────────────────────────────────────

function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      // Wide enough for a mythic at full rarity scale (~141px) so the
      // biggest cards don't overflow their column -- seeing the size
      // difference between bands is the point of this grid.
      gridTemplateColumns: 'repeat(auto-fill, minmax(152px, 1fr))',
      gap: 16,
      alignItems: 'start',
      justifyItems: 'center',
    }}>
      {children}
    </div>
  );
}

function CardTile({ recipe, spell, selected, onClick, footer }: {
  recipe: CardRecipe;
  spell: SpellDef;
  selected?: boolean;
  onClick: () => void;
  footer?: React.ReactNode;
}) {
  const rarity = rarityForGrade(recipe.grade);
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        padding: 6, borderRadius: 4, cursor: 'pointer',
        background: selected ? `${ACCENT}18` : 'transparent',
        outline: selected ? `1px solid ${ACCENT}77` : '1px solid transparent',
      }}
    >
      <SpellCard
        spellId={spell.id}
        spell={spell}
        slotLabel=""
        cooldownSec={0}
        cooldownPct={0}
        width={92}
        height={120}
        recipeOverride={recipe}
        labelOverride={recipe.name}
        forceLit
      />
      <div style={{ color: rarity.gem, fontSize: 9, letterSpacing: 1 }}>
        {rarity.label} · {recipe.grade.toFixed(2)}
      </div>
      {footer}
    </div>
  );
}

/** Parameter readout + the actions that make a look real: bank it, or put it on a spell. */
function RecipeInspector({ recipe, spell, onClose, onMutate }: {
  recipe: CardRecipe;
  spell: SpellDef;
  onClose: () => void;
  onMutate: (r: CardRecipe) => void;
}) {
  const saveToBank = useCardRecipeStore((s) => s.saveToBank);
  const assign = useCardRecipeStore((s) => s.assign);
  const inBank = useCardRecipeStore((s) => !!s.bank[recipe.id]);
  const [note, setNote] = useState('');
  const [assignTo, setAssignTo] = useState('');

  const rarity = rarityForGrade(recipe.grade);
  const target = SPELL_LIST.find((s) => s.id === assignTo);

  return (
    <div style={{
      display: 'flex', gap: 18, alignItems: 'flex-start',
      border: `1px solid ${ACCENT}44`, borderRadius: 5, padding: 14, marginBottom: 16,
      background: 'rgba(255,255,255,0.02)',
    }}>
      {/* Preview: in the target spell's colours once one is chosen, so you
          see the actual result rather than a stand-in palette. */}
      <SpellCard
        spellId={(target ?? spell).id}
        spell={target ?? spell}
        slotLabel=""
        cooldownSec={0}
        cooldownPct={0}
        width={110}
        height={143}
        recipeOverride={recipe}
        labelOverride={target ? target.name : recipe.name}
        forceLit
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div>
            <div style={{ color: '#eee', fontSize: 15 }}>{recipe.name}</div>
            <div style={{ color: rarity.gem, fontSize: 10, letterSpacing: 1, marginTop: 2 }}>
              {rarity.label} · grade {recipe.grade.toFixed(3)} · <span style={{ color: '#666' }}>{recipe.id}</span>
            </div>
          </div>
          <UIButton onClick={onClose} style={btn('#444', '#999')}>close</UIButton>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '4px 14px', marginBottom: 12 }}>
          <Param k="frame" v={recipe.frame} />
          <Param k="border" v={`${recipe.border} ${recipe.borderWidth}px`} />
          <Param k="fill" v={recipe.fill} />
          <Param k="palette" v={recipe.paletteMod} />
          <Param k="texture" v={`${recipe.texture} ${recipe.textureDensity.toFixed(2)}`} />
          <Param k="motion" v={recipe.motion.length ? `${recipe.motion.join(' + ')} @${recipe.motionRate.toFixed(2)}` : 'none'} />
          <Param k="sigil" v={`${recipe.sigilRing} halo ${recipe.sigilHalo.toFixed(2)}`} />
          <Param k="corner" v={recipe.corner} />
          <Param k="aura" v={`${recipe.aura.toFixed(2)}${recipe.auraPulse ? ' pulsing' : ''}`} />
          <Param k="name style" v={recipe.nameCase} />
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="note (optional)"
            style={{ ...selectStyle, flex: '1 1 140px', minWidth: 120 }}
          />
          <UIButton
            onClick={() => saveToBank(recipe, note || undefined)}
            style={btn(inBank ? '#2a6b5a' : '#2a6b2a', inBank ? '#66ddaa' : '#8fdb8f')}
          >
            {inBank ? 'Update in bank' : 'Save to bank'}
          </UIButton>

          <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} style={{ ...selectStyle, maxWidth: 190 }}>
            <option value="">assign to…</option>
            {CLASSES.map((c: string) => (
              <optgroup key={c} label={c}>
                {SPELL_LIST.filter((s) => s.class === c).sort((a, b) => a.tier - b.tier).map((s) => (
                  <option key={s.id} value={s.id}>T{s.tier} {s.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <UIButton
            onClick={() => { if (assignTo) assign(assignTo, recipe); }}
            disabled={!assignTo}
            style={{ ...btn('#4a3a7b', '#c8b0ff'), opacity: assignTo ? 1 : 0.4 }}
          >
            Assign
          </UIButton>

          <UIButton
            onClick={() => onMutate(mutate(recipe))}
            style={btn('#444', '#ccc')}
          >
            Variation
          </UIButton>
        </div>
      </div>
    </div>
  );
}

/** A nearby point in parameter space -- same theme and grade, different roll. Lets you nudge a look you almost like. */
function mutate(recipe: CardRecipe): CardRecipe {
  return generateRecipe(seedFromString(recipe.id, Date.now() & 0xffff), {
    grade: Math.min(1, Math.max(0, recipe.grade + (Math.random() - 0.5) * 0.08)),
    theme: themeOf(recipe),
  });
}

/** Best guess at which theme produced a recipe, so a variation stays in family. */
function themeOf(recipe: CardRecipe): ThemeId {
  const hit = THEME_LIST.find((t) => t.textures.includes(recipe.texture) && t.frames.includes(recipe.frame));
  return (hit ?? THEME_LIST.find((t) => t.frames.includes(recipe.frame)) ?? THEME_LIST[0]).id;
}

function Param({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10 }}>
      <span style={{ color: '#777' }}>{k}</span>
      <span style={{ color: '#ccc', textAlign: 'right' }}>{v}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ color: '#777', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</span>
      {children}
    </div>
  );
}

function btn(border: string, color: string) {
  return {
    background: 'none', border: `1px solid ${border}`, borderRadius: 3, color,
    fontSize: 10, padding: '4px 10px', cursor: 'pointer', letterSpacing: 1,
    fontFamily: BODY_FONT,
  } as const;
}

const selectStyle = {
  background: '#0c0c16', border: '1px solid #333', borderRadius: 3, color: '#ddd',
  fontSize: 11, padding: '5px 6px', fontFamily: BODY_FONT,
} as const;
