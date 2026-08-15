import { useState, useEffect } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { useNetworkStore } from '../../stores/networkStore';
import { getSpell, MOBILITY_SPELL } from 'shared/spells';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import type { WizardClass } from '../../types/game.types';
import { UIButton } from './UIButton';
import { SpellTypeIcon, iconKindForSpellId } from './SpellTypeIcon';
import { C2S } from 'shared/events';

const CLASS_COLORS: Record<WizardClass, string> = {
  fire: '#ff4500', ice: '#a0d8ff', dark: '#cc00ff', sword: '#c8c8c8', earth: '#8B6914',
};

const SKILL_DESCRIPTIONS: Record<string, { label: string; description: string }> = {
  ember_flick:    { label: 'Ember Flick',       description: 'Fast projectile warning shot.' },
  spark_shot:     { label: 'Spark Shot',        description: 'Rapid-fire sparks. 0.12s cooldown. Machine-gun fire.' },
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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2,2,8,0.92)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500,
        fontFamily: "'Courier New', monospace",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
          const canvas = document.querySelector('canvas');
          if (canvas) setTimeout(() => { if (!document.pointerLockElement) canvas.requestPointerLock(); }, 50);
        }
      }}
    >
      <div style={{
        width: 540,
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(8,8,20,0.98)',
        border: `1px solid ${classColor}44`,
        borderRadius: 6,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px 12px',
          borderBottom: '1px solid #252535',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ color: classColor, fontSize: 11, letterSpacing: 5, textTransform: 'uppercase', marginBottom: 2 }}>
              {wizardClass ?? 'Wizard'} — Paused
            </div>
            <div style={{ color: '#aaa', fontSize: 11, letterSpacing: 2 }}>
              {local.kills} kill{local.kills !== 1 ? 's' : ''} · {local.skillPoints} skill point{local.skillPoints !== 1 ? 's' : ''} available
            </div>
          </div>
          <UIButton
            onClick={onClose}
            locksPointer
            style={{
              background: 'none',
              border: '1px solid #444',
              borderRadius: 3,
              color: '#ccc',
              fontSize: 11,
              padding: '4px 10px',
              cursor: 'pointer',
              letterSpacing: 2,
            }}
          >
            ESC
          </UIButton>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #252535' }}>
          {(['spells', 'glossary', 'settings'] as Tab[]).map(t => (
            <UIButton
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                borderBottom: tab === t ? `2px solid ${classColor}` : '2px solid transparent',
                color: tab === t ? classColor : '#aaa',
                fontSize: 11,
                letterSpacing: 3,
                padding: '10px 0',
                cursor: 'pointer',
                textTransform: 'uppercase',
                transition: 'color 0.15s',
              }}
            >
              {t}
            </UIButton>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {tab === 'spells' && (
            <SpellsTab local={local} mobilitySpell={mobilitySpell} classColor={classColor} ws={ws} />
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
      </div>

      <div style={{ color: '#888', fontSize: 11, letterSpacing: 2, marginTop: 14 }}>
        Press Escape or click outside to resume
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

function SpellsTab({ local, mobilitySpell, classColor, ws }: {
  local: LocalLike;
  mobilitySpell: ReturnType<typeof getSpell>;
  classColor: string;
  ws: WebSocketClient;
}) {
  const [selectedSlot, setSelectedSlot] = useState(0);

  const equippableIds = local.unlockedNodes.filter(id => {
    const s = getSpell(id);
    return s && s.class === local.class && s.type !== 'passive' && s.type !== 'mobility';
  });

  function equipSpell(spellId: string | null) {
    ws.send(C2S.EQUIP_SPELL, { slotIndex: selectedSlot, spellId });
  }

  return (
    <div>
      {/* Slot selector */}
      <div style={{ color: '#aaa', fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 10 }}>
        Spell Slots — click to select
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        {local.equippedSpells.map((spellId, i) => {
          const spell = spellId ? getSpell(spellId) : null;
          const isSelected = selectedSlot === i;
          return (
            <UIButton
              key={i}
              onClick={() => setSelectedSlot(i)}
              style={{
                flex: 1,
                padding: '10px 6px',
                background: isSelected ? `${classColor}22` : '#080814',
                border: `1px solid ${isSelected ? classColor : '#2a2a3c'}`,
                borderRadius: 4,
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 0.12s',
              }}
            >
              <div style={{ color: isSelected ? classColor : '#666', fontSize: 9, letterSpacing: 2, marginBottom: 5 }}>SLOT {i + 1}</div>
              {spell ? (
                <>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: spell.color, margin: '0 auto 5px', boxShadow: `0 0 5px ${spell.glowColor}` }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    <SpellTypeIcon kind={spell.type} size={11} color={isSelected ? classColor : '#888'} />
                    <div style={{ color: isSelected ? classColor : '#ccc', fontSize: 10, lineHeight: 1.3 }}>{spell.name}</div>
                  </div>
                </>
              ) : (
                <div style={{ color: '#444', fontSize: 11, marginTop: 4 }}>—</div>
              )}
            </UIButton>
          );
        })}
      </div>

      {/* Unequip button */}
      {local.equippedSpells[selectedSlot] && (
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
            marginBottom: 18,
            textTransform: 'uppercase',
          }}
        >
          Clear slot {selectedSlot + 1}
        </UIButton>
      )}
      {!local.equippedSpells[selectedSlot] && <div style={{ marginBottom: 18 }} />}

      {/* Mobility slot (display only) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #1c1c2c', marginBottom: 16 }}>
        <div style={{ width: 28, height: 28, borderRadius: 3, background: mobilitySpell ? `${mobilitySpell.color}22` : '#0a0a14', border: `1px solid ${mobilitySpell ? mobilitySpell.color + '55' : '#333'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#aaa', flexShrink: 0 }}>⇧</div>
        {mobilitySpell ? (
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: mobilitySpell.color }} />
              <div style={{ color: '#eee', fontSize: 12 }}>{mobilitySpell.name}</div>
              <div style={{ color: '#666', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>mobility · Shift</div>
            </div>
            <div style={{ color: '#888', fontSize: 10 }}>{mobilitySpell.cooldown}s cooldown</div>
          </div>
        ) : (
          <div style={{ color: '#888', fontSize: 12, fontStyle: 'italic' }}>No mobility spell</div>
        )}
      </div>

      {/* Unlocked spells list */}
      <div style={{ color: '#aaa', fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 10 }}>
        Unlocked Spells — click to equip into slot {selectedSlot + 1}
      </div>

      {equippableIds.length === 0 ? (
        <div style={{ color: '#888', fontSize: 12, fontStyle: 'italic', lineHeight: 1.6 }}>
          No equippable spells unlocked yet.<br />
          <span style={{ fontSize: 11 }}>Open the Skill Tree (Tab) and spend skill points.</span>
        </div>
      ) : (
        equippableIds.map(id => {
          const spell = getSpell(id);
          if (!spell) return null;
          const equippedInSlot = local.equippedSpells.indexOf(id);
          const isEquipped = equippedInSlot !== -1;
          const isInSelectedSlot = equippedInSlot === selectedSlot;
          return (
            <UIButton
              key={id}
              onClick={() => equipSpell(id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 0',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid #1c1c2c',
                cursor: 'pointer',
                textAlign: 'left',
                opacity: isInSelectedSlot ? 0.5 : 1,
              }}
            >
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: spell.color, flexShrink: 0, boxShadow: `0 0 4px ${spell.glowColor}` }} />
              <div style={{ flex: 1 }}>
                <div style={{ color: isEquipped ? classColor : '#ddd', fontSize: 12, marginBottom: 2 }}>
                  {spell.name}
                  {isEquipped && (
                    <span style={{ color: classColor, fontSize: 9, marginLeft: 8, letterSpacing: 1 }}>
                      ✓ slot {equippedInSlot + 1}
                    </span>
                  )}
                </div>
                <div style={{ color: '#777', fontSize: 10 }}>
                  {spell.damage > 0 && <span style={{ marginRight: 10 }}>{spell.damage} dmg</span>}
                  {spell.cooldown > 0 && <span style={{ marginRight: 10 }}>{spell.cooldown}s cd</span>}
                  {spell.statusEffect && <span style={{ color: '#aa88ff' }}>+{spell.statusEffect}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                <SpellTypeIcon kind={spell.type} size={12} color="#777" />
                <div style={{ color: '#555', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>{spell.type}</div>
              </div>
            </UIButton>
          );
        })
      )}
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
      {unlockedList.map(({ id, label, description }) => (
        <div key={id} style={{ padding: '10px 0', borderBottom: '1px solid #1c1c2c' }}>
          <div style={{ color: classColor, fontSize: 12, marginBottom: 3 }}>{label}</div>
          <div style={{ color: '#bbb', fontSize: 11, lineHeight: 1.5 }}>{description}</div>
        </div>
      ))}
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
    <div>
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
