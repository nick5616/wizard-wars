import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { useNetworkStore } from '../../stores/networkStore';
import { getSpell, MOBILITY_SPELL, MAX_SPELL_SLOTS, isEquippableSpell } from 'shared/spells';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import type { SpellDef, WizardClass } from '../../types/game.types';
import { UIButton } from './UIButton';
import { SpellTypeIcon, iconKindForSpellId } from './SpellTypeIcon';
import { SpellCard } from './SpellCard';
import { WizardPreview } from './WizardPreview';
import { C2S } from 'shared/events';

const CLASS_COLORS: Record<WizardClass, string> = {
  fire: '#ff4500', ice: '#a0d8ff', dark: '#cc00ff', sword: '#c8c8c8', earth: '#8B6914',
};

const SKILL_DESCRIPTIONS: Record<string, { label: string; description: string }> = {
  ember_flick:    { label: 'Ember Flick',       description: 'Fast projectile warning shot.' },
  spark_shot:     { label: 'Spark Shot',        description: 'Rapid-fire sparks. 0.12s cooldown. Machine-gun fire.' },
  rune_ember:     { label: 'Ember Rune',        description: 'Place a rune. Detonates on the first enemy to step in it. Damage + burn.' },
  rune_magma:     { label: 'Magma Rune',        description: 'Powerful rune. Massive damage + burn on trigger.' },
  kindling:       { label: 'Kindling',           description: '+10% damage per Ember Flick hit, stacks 3×.' },
  fireball:       { label: 'Fireball',           description: 'Heavy explosive projectile. The fire class identity.' },
  combustion:     { label: 'Combustion',         description: 'All fire spells apply burn, stacks 3×.' },
  cauterize:      { label: 'Cauterize',          description: 'Beam that slows and disorients.' },
  lightning_strike: { label: 'Lightning Strike', description: 'Telegraphed bolt from above. Stuns briefly.' },
  static_charge:  { label: 'Static Charge',     description: 'Lightning hits stun briefly.' },
  chain_lightning:{ label: 'Chain Lightning',   description: 'Bounces between 3 enemies.' },
  immolate:       { label: 'Immolate',           description: 'Coat yourself in fire. Melee contact burns.' },
  backdraft:      { label: 'Backdraft',          description: 'Taking damage while Immolate active explodes.' },
  eruption:       { label: 'Eruption',           description: 'Fire pillar erupts beneath target after a short delay.' },
  amaterasu:      { label: 'Amaterasu',          description: 'Black fire placed on target. Burns eternally.' },
  solar_flare:    { label: 'Solar Flare',        description: 'Brief flash on hit. Momentary blind.' },
  inferno_domain: { label: 'Inferno Domain',    description: 'Domain: projectiles accelerate toward center. 10s.' },
  phoenix:        { label: 'Phoenix',            description: 'Once per life, fatal blow leaves you at 20% HP.' },
  god_ray:        { label: 'God Ray',            description: 'Hitscan. Concentrated sunlight. Instant. Melts.' },
  frost_bite:     { label: 'Frost Bite',         description: 'Cone of cold. Minor slow.' },
  frost_needle:   { label: 'Frost Needle',       description: 'Rapid-fire ice needles. 0.15s cooldown. Each hit briefly slows.' },
  brittle:        { label: 'Brittle',            description: 'Slowed enemies take +15% damage.' },
  glacial_spike:  { label: 'Glacial Spike',      description: 'Fast piercing spike. The ice class identity.' },
  flash_freeze:   { label: 'Flash Freeze',       description: 'Two ice spells within 1.5s = briefly frozen.' },
  ice_wall:       { label: 'Ice Wall',           description: 'Conjure a wall. Blocks projectiles. Shatterable.' },
  frost_nova:     { label: 'Frost Nova',         description: 'Ground pulse freezes nearby enemies 1.5s.' },
  permafrost:     { label: 'Permafrost',         description: 'Ground you walk frosts briefly, slowing pursuers.' },
  blizzard:       { label: 'Blizzard',           description: 'Sustained overhead storm. 5s chip damage + slow.' },
  shatter:        { label: 'Shatter',            description: 'Detonate a frozen enemy for massive burst.' },
  glass_cannon:   { label: 'Glass Cannon',       description: 'Shattering resets Glacial Spike cooldown.' },
  cryo_lance:     { label: 'Cryo Lance',         description: 'Enormous slow spike. Triple damage. Wall piercing.' },
  cryogenic:      { label: 'Cryogenic',          description: 'All impacts leave lingering cold zones.' },
  absolute_zero:  { label: 'Absolute Zero',      description: 'Domain: near-total stillness. 3s. Telegraphed.' },
  hypothermia:    { label: 'Hypothermia',        description: 'Enemies exiting Absolute Zero stay slowed 2s.' },
  divine_judgement: { label: 'Divine Judgement', description: 'Silent. Perfect. Frozen targets shatter instantly.' },
  rune_rime:      { label: 'Rime Rune',          description: 'Place a rune. Detonates on the first enemy to step in it. Damage + slow.' },
  rune_glacier:   { label: 'Glacier Rune',       description: 'Powerful rune. Massive damage + full freeze on trigger.' },
  void_touch:     { label: 'Void Touch',         description: 'Short range dark pulse. Cosmically wrong.' },
  void_tap:       { label: 'Void Tap',           description: 'Point-blank void strike. 0.1s cooldown. Melee pace.' },
  unnerving:      { label: 'Unnerving Presence', description: 'Nearby enemies have degraded movement accuracy.' },
  soul_drain:     { label: 'Soul Drain',         description: 'Sustained beam steals health. Roots you. 2s.' },
  hollow:         { label: 'Hollow',             description: 'Enemies below 30% HP take +20% dark damage.' },
  obliterate:     { label: 'Obliterate',         description: 'Pure destruction. No utility. The void given form.' },
  blood_lance:    { label: 'Blood Lance',        description: '(Vampiric) Fast projectile that heals on hit.' },
  crimson_hunger: { label: 'Crimson Hunger',     description: 'Kills restore a burst of HP. Snowballs.' },
  blood_nova:     { label: 'Blood Nova',         description: 'Explosion heals for all damage dealt. Self-centered.' },
  crimson_veil:   { label: 'Crimson Veil',       description: 'Vampiric kills grant brief damage reduction.' },
  void_bloom:     { label: 'Void Bloom',         description: '(Void) Slow orb explodes into void tendrils.' },
  entropy:        { label: 'Entropy',            description: 'Each void spell permanently reduces enemy max HP.' },
  singularity:    { label: 'Singularity',        description: 'Gravity well pulls projectiles and enemies. 3s.' },
  unraveling:     { label: 'Unraveling',         description: 'Void-affected enemies slow cumulatively.' },
  event_horizon:  { label: 'Event Horizon',      description: 'Domain: gravitational chaos. Pull everything. 4s.' },
  undying:        { label: 'Undying',            description: 'Fatal blow triggers Phase Slip automatically. 1 HP.' },
  null_gaze:      { label: 'Null Gaze',          description: 'Hitscan through walls. Leaves void trail 3s.' },
  the_abyss:      { label: 'The Abyss',          description: 'After Null Gaze, next spell is free and instant.' },
  death_note:     { label: 'Death Note',         description: 'Write their name. They die. Once per life.' },
  rune_hex:       { label: 'Hex Rune',           description: 'Place a rune. Detonates on the first enemy to step in it. Heals you on trigger.' },
  rune_soul:      { label: 'Soul Rune',          description: 'Powerful rune. Massive damage. Heavily heals you on trigger.' },
  iron_edge:      { label: 'Iron Edge',          description: 'Quick slash. Crisp. Immediate. No nonsense.' },
  quick_cut:      { label: 'Quick Cut',          description: 'Blindingly fast slash. 0.09s cooldown. Almost no pause between swings.' },
  footwork:       { label: 'Footwork',           description: 'Slightly increased base movement speed.' },
  bladestorm:     { label: 'Bladestorm',         description: 'Spinning blades in spread arc. Punishes dashes.' },
  keen_edge:      { label: 'Keen Edge',          description: 'Every 5th spell hit deals double damage.' },
  phantom_blade:  { label: 'Phantom Blade',      description: 'Orbiting sword mirrors your next 2 casts.' },
  parry:          { label: 'Parry',              description: 'Reflects the next incoming projectile back.' },
  counter:        { label: 'Counter',            description: 'Parry resets Iron Edge. Free empowered slash.' },
  riposte:        { label: 'Riposte',            description: 'After parry, teleport-lunge to the sender.' },
  blade_rain:     { label: 'Blade Rain',         description: 'Dozens of blades fall in a zone. Area denial.' },
  iron_will:      { label: 'Iron Will',          description: 'Warlord spells grant -5% incoming damage for 3s.' },
  siege_blade:    { label: 'Siege Blade',        description: 'Enormous slow blade. Destroys Ice Walls.' },
  razors_edge:    { label: "Razor's Edge",       description: 'Phantom Blade mirrors 3 casts. Parry resets Keen Edge.' },
  sovereign_cut:  { label: 'Sovereign Cut',      description: 'Enormous telegraphed strike. Devastating if it lands.' },
  inevitable:     { label: 'Inevitable',         description: 'Sovereign Cut CD reduces 2s per spell hit after last use.' },
  the_last_word:  { label: 'The Last Word',      description: 'Domain: time slows for all but you. 3s.' },
  final_form:     { label: 'Final Form',         description: 'During The Last Word, every hit deals double damage.' },
  gods_edge:      { label: "God's Edge",         description: 'Hitscan. Cuts clean. Bypasses Parry.' },
  rune_snare:     { label: 'Snare Rune',         description: 'Place a rune. Detonates on the first enemy to step in it. Damage + stun.' },
  rune_executioner: { label: "Executioner's Rune", description: 'Powerful rune. Massive damage + long stun on trigger.' },
  pebble_shot:    { label: 'Pebble Shot',        description: 'Small fast rock. Humble. Accurate. Do not underestimate.' },
  dirt_clod:      { label: 'Dirt Clod',          description: '3-shot scatter burst. 0.18s cooldown. Fires rapidly.' },
  earthen_skin:   { label: 'Earthen Skin',       description: '-5% damage received. -10% below half HP.' },
  stone_spire:    { label: 'Stone Spire',        description: 'Erupts at target after 0.4s. Punishes predictability.' },
  tremor_sense:   { label: 'Tremor Sense',       description: 'Faint footstep vibrations visible through nearby walls.' },
  rock_wall:      { label: 'Rock Wall',          description: 'Stone wall. Tougher than Ice Wall. 15s duration.' },
  geologic:       { label: 'Geologic',           description: 'Each cast increases defense. Stacks 4×. Resets on hit.' },
  avalanche:      { label: 'Avalanche',          description: 'Massive slow boulder. Staggers. Ancient and unstoppable.' },
  bedrock:        { label: 'Bedrock',            description: 'Standing still 1.5s: +20% damage, reduced spell cost.' },
  petrify:        { label: 'Petrify',            description: 'Encases enemy in stone 2.5s. Full CC. Long cast.' },
  fossilize:      { label: 'Fossilize',          description: 'After Petrify breaks, enemy stays slowed 4s.' },
  fissure:        { label: 'Fissure',            description: 'Split ground in a line. Airborne = +25% damage taken.' },
  the_deep:       { label: 'The Deep',           description: 'Stone Launch automatically triggers a small Fissure.' },
  terra_domain:   { label: 'Terra Domain',       description: 'Domain: stone spires erupt randomly. 5s. You are immune.' },
  tectonic:       { label: 'Tectonic',           description: 'After Terra Domain, Bedrock activates instantly.' },
  the_monolith:   { label: 'The Monolith',       description: 'Hitscan. Visible 1s before firing. Hits like geology.' },
  rune_root:      { label: 'Root Rune',          description: 'Place a rune. Detonates on the first enemy to step in it. Damage + stun.' },
  rune_seismic:   { label: 'Seismic Rune',       description: 'Powerful rune. Massive damage + stun in a huge radius.' },
};

type Tab = 'spells' | 'glossary' | 'settings';

interface PauseMenuProps {
  ws: WebSocketClient;
  onClose: () => void;
  experimentLabAvailable?: boolean;
  onOpenExperimentLab?: () => void;
}

export function PauseMenu({ ws, onClose, experimentLabAvailable, onOpenExperimentLab }: PauseMenuProps) {
  const local = useGameStore((s) => s.local);
  const [tab, setTab] = useState<Tab>('spells');

  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);

  const wizardClass = local.class;
  const classColor = wizardClass ? CLASS_COLORS[wizardClass] : '#aaa';
  const mobilitySpellId = wizardClass ? MOBILITY_SPELL[wizardClass] : null;
  const mobilitySpell = mobilitySpellId ? getSpell(mobilitySpellId) : null;

  const unlockedList = local.unlockedNodes
    .map(id => ({ id, ...SKILL_DESCRIPTIONS[id] }))
    .filter(n => n.label);

  // Preview's wand gem tracks the currently-selected hotbar slot, same
  // convention as the in-world model (see WizardPreview.tsx) -- also the
  // intended hook point for future spell-driven cosmetics.
  const activeSpellId = local.equippedSpells[local.activeSlot] ?? null;
  const gemColor = (activeSpellId ? getSpell(activeSpellId)?.color : null) ?? classColor;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#050508',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 500,
        fontFamily: "'Courier New', monospace",
      }}
    >
      {/* Header */}
      <div style={{
        padding: '20px 32px 16px',
        borderBottom: '1px solid #252535',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ color: classColor, fontSize: 13, letterSpacing: 6, textTransform: 'uppercase', marginBottom: 3 }}>
            {wizardClass ?? 'Wizard'} — Paused
          </div>
          <div style={{ color: '#aaa', fontSize: 11, letterSpacing: 2 }}>
            {local.kills} kill{local.kills !== 1 ? 's' : ''} · {local.skillPoints} skill point{local.skillPoints !== 1 ? 's' : ''} available
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ color: '#666', fontSize: 10, letterSpacing: 1 }}>Press Escape to resume</div>
          <UIButton
            onClick={onClose}
            locksPointer
            style={{
              background: 'none',
              border: '1px solid #444',
              borderRadius: 3,
              color: '#ccc',
              fontSize: 11,
              padding: '5px 12px',
              cursor: 'pointer',
              letterSpacing: 2,
            }}
          >
            ESC
          </UIButton>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #252535', padding: '0 32px', flexShrink: 0 }}>
        {(['spells', 'glossary', 'settings'] as Tab[]).map(t => (
          <UIButton
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? `2px solid ${classColor}` : '2px solid transparent',
              color: tab === t ? classColor : '#aaa',
              fontSize: 11,
              letterSpacing: 3,
              padding: '12px 22px',
              cursor: 'pointer',
              textTransform: 'uppercase',
              transition: 'color 0.15s',
            }}
          >
            {t}
          </UIButton>
        ))}
      </div>

      {/* Body: tab content (left) + wizard preview (right) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '26px 32px 40px' }}>
          {tab === 'spells' && (
            <SpellsTab local={local} mobilitySpell={mobilitySpell} mobilitySpellId={mobilitySpellId} classColor={classColor} ws={ws} />
          )}
          {tab === 'glossary' && (
            <GlossaryTab unlockedList={unlockedList} classColor={classColor} />
          )}
          {tab === 'settings' && (
            <SettingsTab
              ws={ws}
              onClose={onClose}
              classColor={classColor}
              experimentLabAvailable={experimentLabAvailable}
              onOpenExperimentLab={onOpenExperimentLab}
            />
          )}
        </div>

        {/* Wizard preview panel -- also where future cosmetic changes tied to
            equipped spells will show up. */}
        <div style={{
          width: 360,
          flexShrink: 0,
          borderLeft: '1px solid #252535',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(0,0,0,0.15) 100%)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <WizardPreview color={classColor} level={local.level} gemColor={gemColor} />
          </div>
          <div style={{ padding: '14px 20px 26px', borderTop: '1px solid #1c1c2c', textAlign: 'center', flexShrink: 0 }}>
            {local.username && (
              <div style={{ color: '#ddd', fontSize: 13, letterSpacing: 1, marginBottom: 3 }}>{local.username}</div>
            )}
            <div style={{ color: classColor, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase' }}>
              {wizardClass ?? 'Wizard'} · Level {local.level}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface LocalLike {
  equippedSpells: (string | null)[];
  kills: number;
  skillPoints: number;
  class: WizardClass | null;
  unlockedNodes: string[];
  cooldowns: Record<string, number>;
}

const SECTION_HEADER_STYLE = { color: '#aaa', fontSize: 10, letterSpacing: 3, textTransform: 'uppercase' as const, marginBottom: 14 };
const SLOT_KEY_LABEL_STYLE = { fontSize: 10, letterSpacing: 2, color: '#888', marginBottom: 6, textTransform: 'uppercase' as const };

interface FlyingState {
  spellId: string;
  spell: SpellDef;
  from: DOMRect;
  to: DOMRect;
}

function SpellsTab({ local, mobilitySpell, mobilitySpellId, classColor, ws }: {
  local: LocalLike;
  mobilitySpell: ReturnType<typeof getSpell>;
  mobilitySpellId: string | null;
  classColor: string;
  ws: WebSocketClient;
}) {
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [flying, setFlying] = useState<FlyingState | null>(null);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const equippableIds = local.unlockedNodes.filter(id => {
    const s = getSpell(id);
    return s && s.class === local.class && isEquippableSpell(s);
  });
  // Slots open one-by-one as spells unlock, capped at MAX_SPELL_SLOTS (keys 1-9,0).
  const visibleSlots = Math.min(equippableIds.length, MAX_SPELL_SLOTS);

  function equipSpell(spellId: string | null) {
    ws.send(C2S.EQUIP_SPELL, { slotIndex: selectedSlot, spellId });
  }

  // Click a card in the grid below: kick off the equip immediately (the real
  // slot updates whenever the next server tick lands) and, cosmetically, fly
  // a clone of the card from its grid position over to the target slot.
  function onGridCardClick(spellId: string) {
    const spell = getSpell(spellId);
    if (!spell) return;
    const fromEl = cardRefs.current.get(spellId);
    const toEl = slotRefs.current[selectedSlot];
    if (fromEl && toEl) {
      setFlying({ spellId, spell, from: fromEl.getBoundingClientRect(), to: toEl.getBoundingClientRect() });
    }
    equipSpell(spellId);
  }

  // Slot keys read 1-9 then 0, matching the "1234567890" top-row layout.
  const slotLabel = (i: number) => (i < 9 ? i + 1 : 0);

  return (
    <div>
      {/* Hotbar -- a live rendering of the actual HUD spell bar (see SpellBar.tsx).
          Click a slot to select it, then click a spell below to equip it there. */}
      <div style={SECTION_HEADER_STYLE}>Your hotbar — click a slot to select it</div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 18, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={SLOT_KEY_LABEL_STYLE}>Shift</div>
          <SpellCard
            spellId={mobilitySpellId}
            spell={mobilitySpell}
            slotLabel="⇧"
            cooldownSec={0}
            cooldownPct={0}
            width={82}
            height={106}
          />
          {mobilitySpell && (
            <div style={{ color: '#666', fontSize: 9, marginTop: 6, letterSpacing: 1 }}>{mobilitySpell.cooldown}s cd · mobility</div>
          )}
        </div>

        <div style={{ width: 1, alignSelf: 'stretch', background: '#252535', margin: '0 2px 16px' }} />

        {local.equippedSpells.slice(0, visibleSlots).map((spellId, i) => {
          const spell = spellId ? getSpell(spellId) : null;
          return (
            <div key={i} ref={(el) => { slotRefs.current[i] = el; }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ ...SLOT_KEY_LABEL_STYLE, color: selectedSlot === i ? classColor : '#888' }}>{slotLabel(i)}</div>
              <SpellCard
                spellId={spellId}
                spell={spell}
                slotLabel={String(slotLabel(i))}
                cooldownSec={0}
                cooldownPct={0}
                active={selectedSlot === i}
                onClick={() => setSelectedSlot(i)}
                width={92}
                height={120}
              />
            </div>
          );
        })}
      </div>

      {/* Unequip button */}
      {local.equippedSpells[selectedSlot] ? (
        <UIButton
          onClick={() => equipSpell(null)}
          style={{
            padding: '4px 12px',
            background: 'rgba(120,0,0,0.18)',
            border: '1px solid #660000',
            borderRadius: 3,
            color: '#ff8888',
            fontSize: 10,
            letterSpacing: 2,
            cursor: 'pointer',
            marginBottom: 26,
            textTransform: 'uppercase',
          }}
        >
          Clear slot {slotLabel(selectedSlot)}
        </UIButton>
      ) : (
        <div style={{ marginBottom: 26 }} />
      )}

      {/* Unlocked spells grid */}
      <div style={SECTION_HEADER_STYLE}>Unlocked spells — click to equip into slot {slotLabel(selectedSlot)}</div>

      {equippableIds.length === 0 ? (
        <div style={{ color: '#888', fontSize: 12, fontStyle: 'italic', lineHeight: 1.6 }}>
          No equippable spells unlocked yet.<br />
          <span style={{ fontSize: 11 }}>Open the Skill Tree (Tab) and spend skill points.</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: '22px 18px' }}>
          {equippableIds.map(id => {
            const spell = getSpell(id);
            if (!spell) return null;
            const equippedInSlot = local.equippedSpells.indexOf(id);
            const isEquipped = equippedInSlot !== -1;
            const isInSelectedSlot = equippedInSlot === selectedSlot;
            return (
              <div
                key={id}
                ref={(el) => { if (el) cardRefs.current.set(id, el); else cardRefs.current.delete(id); }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: isInSelectedSlot ? 0.45 : 1 }}
              >
                <SpellCard
                  spellId={id}
                  spell={spell}
                  slotLabel=""
                  cooldownSec={0}
                  cooldownPct={0}
                  onClick={() => onGridCardClick(id)}
                  width={104}
                  height={136}
                />
                <div style={{ marginTop: 7, textAlign: 'center' }}>
                  <div style={{ color: '#777', fontSize: 10 }}>
                    {spell.damage > 0 && <span style={{ marginRight: 8 }}>{spell.damage} dmg</span>}
                    {spell.cooldown > 0 && <span>{spell.cooldown}s cd</span>}
                  </div>
                  {spell.statusEffect && <div style={{ color: '#aa88ff', fontSize: 9, marginTop: 1 }}>+{spell.statusEffect}</div>}
                  {isEquipped && (
                    <div style={{ color: classColor, fontSize: 9, letterSpacing: 1, marginTop: 3 }}>
                      ✓ slot {equippedInSlot < 9 ? equippedInSlot + 1 : 0}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {flying && (
        <FlyingCard
          spellId={flying.spellId}
          spell={flying.spell}
          from={flying.from}
          to={flying.to}
          onDone={() => setFlying(null)}
        />
      )}
    </div>
  );
}

/** Cosmetic clone of a spell card that animates from a grid card's position to its target hotbar slot on equip; the real slot re-renders underneath once the server confirms. Fixed positioning escapes the scrolling tab content, so this reads correctly regardless of scroll offset. */
function FlyingCard({ spellId, spell, from, to, onDone }: {
  spellId: string;
  spell: SpellDef;
  from: DOMRect;
  to: DOMRect;
  onDone: () => void;
}) {
  const [flownIn, setFlownIn] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setFlownIn(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;

  return (
    <div
      style={{
        position: 'fixed',
        left: from.left,
        top: from.top,
        width: from.width,
        height: from.height,
        transformOrigin: 'top left',
        transform: flownIn ? `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})` : 'translate(0px, 0px) scale(1, 1)',
        transition: 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
        pointerEvents: 'none',
        zIndex: 700,
        filter: 'drop-shadow(0 10px 22px rgba(0,0,0,0.65))',
      }}
      onTransitionEnd={onDone}
    >
      <SpellCard spellId={spellId} spell={spell} slotLabel="" cooldownSec={0} cooldownPct={0} width={from.width} height={from.height} />
    </div>
  );
}

function GlossaryTab({ unlockedList, classColor }: {
  unlockedList: { id: string; label: string; description: string }[];
  classColor: string;
}) {
  if (unlockedList.length === 0) {
    return (
      <div style={{ color: '#bbb', fontSize: 13, textAlign: 'center', marginTop: 32, letterSpacing: 1 }}>
        Nothing unlocked yet.<br />
        <span style={{ fontSize: 11, color: '#888', marginTop: 8, display: 'block' }}>
          Open the Skill Tree (Tab) and spend your skill points.
        </span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ color: '#aaa', fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 14 }}>
        Unlocked — {unlockedList.length} node{unlockedList.length !== 1 ? 's' : ''}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', columnGap: 32 }}>
        {unlockedList.map(({ id, label, description }) => {
          const kind = iconKindForSpellId(id);
          return (
            <div key={id} style={{ padding: '10px 0', borderBottom: '1px solid #1c1c2c' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <div style={{ color: classColor, fontSize: 12 }}>{label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#777' }}>
                  <SpellTypeIcon kind={kind} size={10} color="#777" />
                  <span style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase' }}>{kind}</span>
                </div>
              </div>
              <div style={{ color: '#bbb', fontSize: 11, lineHeight: 1.5 }}>{description}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettingsTab({ ws, onClose, classColor, experimentLabAvailable, onOpenExperimentLab }: {
  ws: WebSocketClient;
  onClose: () => void;
  classColor: string;
  experimentLabAvailable?: boolean;
  onOpenExperimentLab?: () => void;
}) {
  const [muted, setMuted] = useState(false);
  const debugMode = useGameStore((s) => s.debugMode);
  const setDebugMode = useGameStore((s) => s.setDebugMode);
  const players = useGameStore((s) => s.players);
  const roomId = useNetworkStore((s) => s.roomId);
  const inExperiment = !!roomId && roomId.startsWith('experiment-');
  const experimentBotCount = inExperiment ? Object.values(players).filter((p) => p.isBot).length : 0;

  function toggleDebug(v: boolean) {
    setDebugMode(v);
    if (v) ws.send(C2S.DEBUG_GRANT, {});
  }

  function disconnect() {
    ws.disconnect();
    window.location.reload();
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ color: '#aaa', fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 20 }}>
        Settings
      </div>

      <SettingRow label="Mouse sensitivity" value="0.2 (fixed)" />
      <SettingRow label="Field of view" value="80°" />
      <ToggleRow label="Mute effects" value={muted} onChange={setMuted} classColor={classColor} />
      <ToggleRow
        label="Debug mode"
        value={debugMode}
        onChange={toggleDebug}
        classColor="#ffcc00"
        hint="Unlocks all skill tree nodes. Grants 999 points."
      />

      {/* Bots */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1a1a28' }}>
        <span style={{ color: '#ccc', fontSize: 12 }}>Bots</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <UIButton
            onClick={() => ws.send(C2S.SPAWN_BOTS, {})}
            style={{
              padding: '5px 10px', background: 'rgba(0,150,0,0.15)', border: '1px solid #2a6b2a',
              borderRadius: 3, color: '#8fdb8f', fontSize: 10, letterSpacing: 1, cursor: 'pointer', textTransform: 'uppercase',
            }}
          >
            Spawn one of each
          </UIButton>
          <UIButton
            onClick={() => ws.send(C2S.DESPAWN_BOTS, {})}
            style={{
              padding: '5px 10px', background: 'rgba(150,0,0,0.15)', border: '1px solid #6b2a2a',
              borderRadius: 3, color: '#db8f8f', fontSize: 10, letterSpacing: 1, cursor: 'pointer', textTransform: 'uppercase',
            }}
          >
            Clear
          </UIButton>
        </div>
      </div>

      {/* Experiment Lab */}
      {experimentLabAvailable && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1a1a28' }}>
          <div>
            <div style={{ color: '#ccc', fontSize: 12 }}>Experiment Lab</div>
            <div style={{ color: inExperiment ? '#66ddaa' : '#888', fontSize: 10, marginTop: 2 }}>
              {inExperiment
                ? `Experiment in progress — ${experimentBotCount} bot${experimentBotCount !== 1 ? 's' : ''}`
                : 'Sandbox + tournament simulator (localhost only)'}
            </div>
          </div>
          <UIButton
            onClick={() => onOpenExperimentLab?.()}
            style={{
              padding: '5px 10px', background: 'rgba(0,150,120,0.15)', border: '1px solid #2a6b5a',
              borderRadius: 3, color: '#66ddaa', fontSize: 10, letterSpacing: 1, cursor: 'pointer', textTransform: 'uppercase', flexShrink: 0,
            }}
          >
            {inExperiment ? 'Resume' : 'Enter'}
          </UIButton>
        </div>
      )}

      {/* Controls reference */}
      <div style={{ borderTop: '1px solid #252535', marginTop: 24, paddingTop: 24 }}>
        <div style={{ color: '#aaa', fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 14 }}>
          Controls
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 32px' }}>
          {[
            ['Move', 'WASD'],
            ['Jump', 'Space'],
            ['Look', 'Mouse (click canvas)'],
            ['Cast', 'Left click'],
            ['Basic attack', 'Right click'],
            ['Melee', 'F'],
            ['Mobility', 'Shift'],
            ['Switch spell', '1–4 / Scroll'],
            ['Skill tree', 'Tab'],
            ['Pause', 'Escape'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1a1a28' }}>
              <span style={{ color: '#aaa', fontSize: 11 }}>{k}</span>
              <span style={{ color: '#ddd', fontSize: 11, fontFamily: 'monospace' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Disconnect */}
      <div style={{ borderTop: '1px solid #252535', marginTop: 24, paddingTop: 24 }}>
        <UIButton
          onClick={disconnect}
          style={{
            width: '100%', padding: '10px',
            background: 'rgba(180,0,0,0.15)',
            border: '1px solid #880000',
            borderRadius: 4, color: '#ff6666',
            fontSize: 12, letterSpacing: 3,
            cursor: 'pointer', textTransform: 'uppercase',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(180,0,0,0.28)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(180,0,0,0.15)')}
        >
          Disconnect
        </UIButton>
      </div>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1a1a28' }}>
      <span style={{ color: '#ccc', fontSize: 12 }}>{label}</span>
      <span style={{ color: '#888', fontSize: 12 }}>{value}</span>
    </div>
  );
}

function ToggleRow({ label, value, onChange, classColor, hint }: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  classColor: string;
  hint?: string;
}) {
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid #1a1a28' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#ccc', fontSize: 12 }}>{label}</span>
        <UIButton
          onClick={() => onChange(!value)}
          style={{
            width: 40, height: 20, borderRadius: 10,
            background: value ? classColor + '55' : '#1a1a2e',
            border: `1px solid ${value ? classColor : '#444'}`,
            cursor: 'pointer', position: 'relative',
            transition: 'all 0.15s', flexShrink: 0,
          }}
        >
          <div style={{
            width: 14, height: 14, borderRadius: '50%',
            background: value ? classColor : '#888',
            position: 'absolute', top: 2,
            left: value ? 22 : 2,
            transition: 'left 0.15s',
          }} />
        </UIButton>
      </div>
      {hint && value && (
        <div style={{ color: '#888', fontSize: 10, marginTop: 4, letterSpacing: 1 }}>{hint}</div>
      )}
    </div>
  );
}
