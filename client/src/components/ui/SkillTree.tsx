import { useState, useEffect } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { C2S } from 'shared/events';
import type { WebSocketClient } from '../../networking/WebSocketClient';
import { ALL_SPELLS } from 'shared/spells';
import type { WizardClass } from '../../types/game.types';
import { UIButton } from './UIButton';

interface SkillNode {
  id: string;
  label: string;
  type: 'spell' | 'passive';
  tier: number;
  x: number;
  prereqs: string[];
  description: string;
}

const SKILL_TREES: Record<WizardClass, SkillNode[]> = {
  fire: [
    { id: 'ember_flick',     label: 'Ember Flick',      type: 'spell',   tier: 1,  x: 0.5,  prereqs: [],                          description: 'Tiny fast projectile. Warning shot.' },
    { id: 'spark_shot',      label: 'Spark Shot',       type: 'spell',   tier: 2,  x: 0.15, prereqs: ['ember_flick'],             description: 'Rapid-fire sparks. 0.12s cooldown. Machine-gun fire.' },
    { id: 'kindling',        label: 'Kindling',          type: 'passive', tier: 2,  x: 0.75, prereqs: ['ember_flick'],             description: '+10% damage per Ember Flick hit. Stacks 3×.' },
    { id: 'fireball',        label: 'Fireball',          type: 'spell',   tier: 3,  x: 0.5,  prereqs: ['spark_shot', 'kindling'], description: 'Heavy explosive projectile. The class identity.' },
    { id: 'combustion',      label: 'Combustion',        type: 'passive', tier: 4,  x: 0.5,  prereqs: ['fireball'],               description: 'All fire spells apply burn. Stacks 3×.' },
    { id: 'cauterize',       label: 'Cauterize',         type: 'spell',   tier: 5,  x: 0.5,  prereqs: ['combustion'],             description: 'Beam that slows and disorients.' },
    { id: 'lightning_strike',label: 'Lightning Strike',  type: 'spell',   tier: 6,  x: 0.2,  prereqs: ['cauterize'],              description: 'Telegraphed bolt from above. Stuns briefly.' },
    { id: 'static_charge',   label: 'Static Charge',    type: 'passive', tier: 7,  x: 0.2,  prereqs: ['lightning_strike'],        description: 'Lightning hits stun briefly.' },
    { id: 'chain_lightning',  label: 'Chain Lightning',  type: 'spell',   tier: 8,  x: 0.2,  prereqs: ['static_charge'],          description: 'Bounces between 3 enemies.' },
    { id: 'immolate',        label: 'Immolate',          type: 'spell',   tier: 6,  x: 0.8,  prereqs: ['cauterize'],              description: 'Coat yourself in fire. Melee contact burns.' },
    { id: 'backdraft',       label: 'Backdraft',         type: 'passive', tier: 7,  x: 0.8,  prereqs: ['immolate'],               description: 'Taking damage while Immolate active explodes.' },
    { id: 'eruption',        label: 'Eruption',          type: 'spell',   tier: 8,  x: 0.8,  prereqs: ['backdraft'],              description: 'Fire pillar erupts beneath target after delay.' },
    { id: 'amaterasu',       label: 'Amaterasu',         type: 'spell',   tier: 9,  x: 0.5,  prereqs: ['chain_lightning', 'eruption'], description: 'Black fire placed ON target. Burns eternally.' },
    { id: 'solar_flare',     label: 'Solar Flare',       type: 'passive', tier: 10, x: 0.5,  prereqs: ['amaterasu'],              description: 'Brief flash on hit. Momentary blind.' },
    { id: 'inferno_domain',  label: 'Inferno Domain',    type: 'spell',   tier: 11, x: 0.5,  prereqs: ['solar_flare'],            description: 'Domain: projectiles accelerate toward center. 4s.' },
    { id: 'phoenix',         label: 'Phoenix',           type: 'passive', tier: 12, x: 0.5,  prereqs: ['inferno_domain'],         description: 'Once per life, fatal blow leaves you at 20% HP.' },
    { id: 'god_ray',         label: 'God Ray',           type: 'spell',   tier: 13, x: 0.5,  prereqs: ['phoenix'],                description: 'Hitscan. Concentrated sunlight. Instant. Melts.' },
  ],
  ice: [
    { id: 'frost_bite',      label: 'Frost Bite',        type: 'spell',   tier: 1,  x: 0.5,  prereqs: [],                         description: 'Cone of cold. Minor slow.' },
    { id: 'frost_needle',    label: 'Frost Needle',      type: 'spell',   tier: 2,  x: 0.15, prereqs: ['frost_bite'],             description: 'Rapid-fire ice needles. 0.15s cooldown. Each hit briefly slows.' },
    { id: 'brittle',         label: 'Brittle',           type: 'passive', tier: 2,  x: 0.75, prereqs: ['frost_bite'],             description: 'Slowed enemies take +15% damage.' },
    { id: 'glacial_spike',   label: 'Glacial Spike',     type: 'spell',   tier: 3,  x: 0.5,  prereqs: ['frost_needle', 'brittle'], description: 'Fast piercing spike. The class identity.' },
    { id: 'flash_freeze',    label: 'Flash Freeze',      type: 'passive', tier: 4,  x: 0.5,  prereqs: ['glacial_spike'],          description: 'Two ice spells within 1.5s = briefly frozen.' },
    { id: 'ice_wall',        label: 'Ice Wall',          type: 'spell',   tier: 5,  x: 0.5,  prereqs: ['flash_freeze'],           description: 'Conjure a wall. Blocks projectiles. Shatterable.' },
    { id: 'frost_nova',      label: 'Frost Nova',        type: 'spell',   tier: 6,  x: 0.2,  prereqs: ['ice_wall'],               description: 'Ground pulse freezes nearby enemies 1.5s.' },
    { id: 'permafrost',      label: 'Permafrost',        type: 'passive', tier: 7,  x: 0.2,  prereqs: ['frost_nova'],             description: 'Ground you walk frosts briefly, slowing pursuers.' },
    { id: 'blizzard',        label: 'Blizzard',          type: 'spell',   tier: 8,  x: 0.2,  prereqs: ['permafrost'],             description: 'Sustained overhead storm. 5s chip damage + slow.' },
    { id: 'shatter',         label: 'Shatter',           type: 'spell',   tier: 6,  x: 0.8,  prereqs: ['ice_wall'],               description: 'Detonate a frozen enemy for massive burst.' },
    { id: 'glass_cannon',    label: 'Glass Cannon',      type: 'passive', tier: 7,  x: 0.8,  prereqs: ['shatter'],                description: 'Shattering resets Glacial Spike cooldown.' },
    { id: 'cryo_lance',      label: 'Cryo Lance',        type: 'spell',   tier: 8,  x: 0.8,  prereqs: ['glass_cannon'],           description: 'Enormous slow spike. Triple damage. Wall piercing.' },
    { id: 'cryogenic',       label: 'Cryogenic',         type: 'passive', tier: 9,  x: 0.5,  prereqs: ['blizzard', 'cryo_lance'], description: 'All impacts leave lingering cold zones.' },
    { id: 'absolute_zero',   label: 'Absolute Zero',     type: 'spell',   tier: 10, x: 0.5,  prereqs: ['cryogenic'],              description: 'Domain: near-total stillness. 3s. Telegraphed.' },
    { id: 'hypothermia',     label: 'Hypothermia',       type: 'passive', tier: 11, x: 0.5,  prereqs: ['absolute_zero'],          description: 'Enemies exiting Absolute Zero stay slowed 2s.' },
    { id: 'divine_judgement',label: 'Divine Judgement',  type: 'spell',   tier: 12, x: 0.5,  prereqs: ['hypothermia'],            description: 'Silent. Perfect. Frozen targets shatter instantly.' },
  ],
  dark: [
    { id: 'void_touch',      label: 'Void Touch',        type: 'spell',   tier: 1,  x: 0.5,  prereqs: [],                          description: 'Short range dark pulse. Cosmically wrong.' },
    { id: 'void_tap',        label: 'Void Tap',          type: 'spell',   tier: 2,  x: 0.15, prereqs: ['void_touch'],              description: 'Point-blank void strike. 0.1s cooldown. Melee pace.' },
    { id: 'unnerving',       label: 'Unnerving Presence',type: 'passive', tier: 2,  x: 0.75, prereqs: ['void_touch'],              description: 'Nearby enemies have degraded movement accuracy.' },
    { id: 'soul_drain',      label: 'Soul Drain',        type: 'spell',   tier: 3,  x: 0.5,  prereqs: ['void_tap', 'unnerving'],   description: 'Sustained beam steals health. Roots you. 2s.' },
    { id: 'hollow',          label: 'Hollow',            type: 'passive', tier: 4,  x: 0.5,  prereqs: ['soul_drain'],              description: 'Enemies below 30% HP take +20% dark damage.' },
    { id: 'obliterate',      label: 'Obliterate',        type: 'spell',   tier: 5,  x: 0.5,  prereqs: ['hollow'],                  description: 'Pure destruction. No utility. The void given form.' },
    { id: 'blood_lance',     label: 'Blood Lance',       type: 'spell',   tier: 6,  x: 0.2,  prereqs: ['obliterate'],              description: '(Vampiric) Fast projectile that heals on hit.' },
    { id: 'crimson_hunger',  label: 'Crimson Hunger',    type: 'passive', tier: 7,  x: 0.2,  prereqs: ['blood_lance'],             description: 'Kills restore a burst of HP. Snowballs.' },
    { id: 'blood_nova',      label: 'Blood Nova',        type: 'spell',   tier: 8,  x: 0.2,  prereqs: ['crimson_hunger'],          description: 'Explosion heals for all damage dealt. Self-centered.' },
    { id: 'crimson_veil',    label: 'Crimson Veil',      type: 'passive', tier: 9,  x: 0.2,  prereqs: ['blood_nova'],              description: 'Vampiric kills grant brief damage reduction.' },
    { id: 'void_bloom',      label: 'Void Bloom',        type: 'spell',   tier: 6,  x: 0.8,  prereqs: ['obliterate'],              description: '(Void) Slow orb explodes into void tendrils.' },
    { id: 'entropy',         label: 'Entropy',           type: 'passive', tier: 7,  x: 0.8,  prereqs: ['void_bloom'],              description: 'Each void spell permanently reduces enemy max HP.' },
    { id: 'singularity',     label: 'Singularity',       type: 'spell',   tier: 8,  x: 0.8,  prereqs: ['entropy'],                 description: 'Gravity well pulls projectiles and enemies. 3s.' },
    { id: 'unraveling',      label: 'Unraveling',        type: 'passive', tier: 9,  x: 0.8,  prereqs: ['singularity'],             description: 'Void-affected enemies slow cumulatively.' },
    { id: 'event_horizon',   label: 'Event Horizon',     type: 'spell',   tier: 10, x: 0.5,  prereqs: ['crimson_veil', 'unraveling'], description: 'Domain: gravitational chaos. Pull everything. 4s.' },
    { id: 'undying',         label: 'Undying',           type: 'passive', tier: 11, x: 0.5,  prereqs: ['event_horizon'],           description: 'Fatal blow triggers Phase Slip auto. 1HP.' },
    { id: 'null_gaze',       label: 'Null Gaze',         type: 'spell',   tier: 12, x: 0.5,  prereqs: ['undying'],                 description: 'Hitscan through walls. Leaves void trail 3s.' },
    { id: 'the_abyss',       label: 'The Abyss',         type: 'passive', tier: 13, x: 0.5,  prereqs: ['null_gaze'],               description: 'After Null Gaze, next spell is free and instant.' },
    { id: 'death_note',      label: 'Death Note',        type: 'spell',   tier: 14, x: 0.5,  prereqs: ['the_abyss'],               description: 'Write their name. They die. Once per life.' },
  ],
  sword: [
    { id: 'iron_edge',       label: 'Iron Edge',         type: 'spell',   tier: 1,  x: 0.5,  prereqs: [],                          description: 'Quick slash. Crisp. Immediate. No nonsense.' },
    { id: 'quick_cut',       label: 'Quick Cut',         type: 'spell',   tier: 2,  x: 0.15, prereqs: ['iron_edge'],               description: 'Blindingly fast slash. 0.09s cooldown. Almost no pause between swings.' },
    { id: 'footwork',        label: 'Footwork',          type: 'passive', tier: 2,  x: 0.75, prereqs: ['iron_edge'],               description: 'Slightly increased base movement speed.' },
    { id: 'bladestorm',      label: 'Bladestorm',        type: 'spell',   tier: 3,  x: 0.5,  prereqs: ['quick_cut', 'footwork'],   description: 'Spinning blades in spread arc. Punishes dashes.' },
    { id: 'keen_edge',       label: 'Keen Edge',         type: 'passive', tier: 4,  x: 0.5,  prereqs: ['bladestorm'],              description: 'Every 5th spell hit deals double damage.' },
    { id: 'phantom_blade',   label: 'Phantom Blade',     type: 'spell',   tier: 5,  x: 0.5,  prereqs: ['keen_edge'],               description: 'Orbiting sword mirrors next 2 casts.' },
    { id: 'parry',           label: 'Parry',             type: 'spell',   tier: 6,  x: 0.2,  prereqs: ['phantom_blade'],           description: 'Reflects the next incoming projectile back.' },
    { id: 'counter',         label: 'Counter',           type: 'passive', tier: 7,  x: 0.2,  prereqs: ['parry'],                   description: 'Parry resets Iron Edge. Free empowered slash.' },
    { id: 'riposte',         label: 'Riposte',           type: 'spell',   tier: 8,  x: 0.2,  prereqs: ['counter'],                 description: 'After parry, teleport-lunge to sender.' },
    { id: 'blade_rain',      label: 'Blade Rain',        type: 'spell',   tier: 6,  x: 0.8,  prereqs: ['phantom_blade'],           description: 'Dozens of blades fall in a zone. Denial.' },
    { id: 'iron_will',       label: 'Iron Will',         type: 'passive', tier: 7,  x: 0.8,  prereqs: ['blade_rain'],              description: 'Warlord spells grant -5% incoming damage 3s.' },
    { id: 'siege_blade',     label: 'Siege Blade',       type: 'spell',   tier: 8,  x: 0.8,  prereqs: ['iron_will'],               description: 'Enormous slow blade. Destroys Ice Walls.' },
    { id: 'razors_edge',     label: "Razor's Edge",      type: 'passive', tier: 9,  x: 0.5,  prereqs: ['riposte', 'siege_blade'],  description: 'Phantom Blade mirrors 3 casts. Parry resets Keen Edge.' },
    { id: 'sovereign_cut',   label: 'Sovereign Cut',     type: 'spell',   tier: 10, x: 0.5,  prereqs: ['razors_edge'],             description: 'Enormous telegraphed strike. Devastating if it lands.' },
    { id: 'inevitable',      label: 'Inevitable',        type: 'passive', tier: 11, x: 0.5,  prereqs: ['sovereign_cut'],           description: 'Sovereign Cut CD reduces 2s per spell hit after last.' },
    { id: 'the_last_word',   label: 'The Last Word',     type: 'spell',   tier: 12, x: 0.5,  prereqs: ['inevitable'],              description: 'Domain: time slows for all but you. 3s.' },
    { id: 'final_form',      label: 'Final Form',        type: 'passive', tier: 13, x: 0.5,  prereqs: ['the_last_word'],           description: 'During The Last Word, every hit is double.' },
    { id: 'gods_edge',       label: "God's Edge",        type: 'spell',   tier: 14, x: 0.5,  prereqs: ['final_form'],              description: 'Hitscan. Cuts clean. Bypasses Parry.' },
  ],
  earth: [
    { id: 'pebble_shot',     label: 'Pebble Shot',       type: 'spell',   tier: 1,  x: 0.5,  prereqs: [],                          description: 'Small fast rock. Humble. Accurate. Do not underestimate.' },
    { id: 'dirt_clod',       label: 'Dirt Clod',         type: 'spell',   tier: 2,  x: 0.15, prereqs: ['pebble_shot'],             description: '3-shot scatter burst. 0.18s cooldown. Fires rapidly, punishes close range.' },
    { id: 'earthen_skin',    label: 'Earthen Skin',      type: 'passive', tier: 2,  x: 0.75, prereqs: ['pebble_shot'],             description: '-5% damage received. -10% below half HP.' },
    { id: 'stone_spire',     label: 'Stone Spire',       type: 'spell',   tier: 3,  x: 0.5,  prereqs: ['dirt_clod', 'earthen_skin'], description: 'Erupts at target after 0.4s. Punishes predictability.' },
    { id: 'tremor_sense',    label: 'Tremor Sense',      type: 'passive', tier: 4,  x: 0.5,  prereqs: ['stone_spire'],             description: 'Faint footstep vibrations visible through nearby walls.' },
    { id: 'rock_wall',       label: 'Rock Wall',         type: 'spell',   tier: 5,  x: 0.5,  prereqs: ['tremor_sense'],            description: 'Stone wall. Tougher than Ice Wall. 15s duration.' },
    { id: 'geologic',        label: 'Geologic',          type: 'passive', tier: 6,  x: 0.5,  prereqs: ['rock_wall'],               description: 'Each cast increases defense. Stacks 4×. Resets on hit.' },
    { id: 'avalanche',       label: 'Avalanche',         type: 'spell',   tier: 7,  x: 0.5,  prereqs: ['geologic'],                description: 'Massive slow boulder. Staggers. Ancient and unstoppable.' },
    { id: 'bedrock',         label: 'Bedrock',           type: 'passive', tier: 8,  x: 0.5,  prereqs: ['avalanche'],               description: 'Standing still 1.5s: +20% damage, reduced spell cost.' },
    { id: 'petrify',         label: 'Petrify',           type: 'spell',   tier: 9,  x: 0.5,  prereqs: ['bedrock'],                 description: 'Encases enemy in stone 2.5s. Full CC. Long cast.' },
    { id: 'fossilize',       label: 'Fossilize',         type: 'passive', tier: 10, x: 0.5,  prereqs: ['petrify'],                 description: 'After Petrify breaks, enemy stays slowed 4s.' },
    { id: 'fissure',         label: 'Fissure',           type: 'spell',   tier: 11, x: 0.5,  prereqs: ['fossilize'],               description: 'Split ground in a line. Airborne = +25% damage taken.' },
    { id: 'the_deep',        label: 'The Deep',          type: 'passive', tier: 12, x: 0.5,  prereqs: ['fissure'],                 description: 'Stone Launch automatically triggers a small Fissure.' },
    { id: 'terra_domain',    label: 'Terra Domain',      type: 'spell',   tier: 13, x: 0.5,  prereqs: ['the_deep'],                description: 'Domain: stone spires erupt randomly. 5s. You are immune.' },
    { id: 'tectonic',        label: 'Tectonic',          type: 'passive', tier: 14, x: 0.5,  prereqs: ['terra_domain'],            description: 'After Terra Domain, Bedrock activates instantly.' },
    { id: 'the_monolith',    label: 'The Monolith',      type: 'spell',   tier: 15, x: 0.5,  prereqs: ['tectonic'],                description: 'Hitscan. Visible 1s before firing. Hits like geology.' },
  ],
};

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

  function canBuy(node: SkillNode): boolean {
    if (unlocked.has(node.id)) return false;
    if (debugMode) return true;
    if (local.skillPoints <= 0) return false;
    if (node.prereqs.length === 0) return true;
    return node.prereqs.some(p => unlocked.has(p));
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
                  {local.skillPoints <= 0 ? 'No points available' : 'Prerequisites not met'}
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
                  <text textAnchor="middle" dy="4" fontSize={isHovered ? 13 : 11} fill={textColor} style={{ userSelect: 'none' }}>
                    {node.type === 'spell' ? '◆' : '◇'}
                  </text>
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
