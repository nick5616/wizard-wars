/**
 * Canonical per-class skill trees. Shared by server (prereq validation +
 * auto-unlock walk) and client (SkillTree UI). Previously this only existed
 * client-side, which meant the server had no way to validate node purchases.
 *
 * Node fields:
 *   id, label, type ('spell'|'passive'), tier, x, prereqs, description
 *   branchGroup / branch  — marks the one genuine fork per class. The two
 *     sibling nodes sharing a branchGroup are mutually exclusive at unlock
 *     time (resolved via the F1/F2 vote prompt) -- everything downstream
 *     only needs ONE of them satisfied (prereqs are OR'd, see canUnlock),
 *     so picking a side and staying there is a first-class path, not a
 *     temporary detour.
 *   shouldReplace — optional explicit auto-equip override (see
 *     ProgressionSystem's auto-equip resolution). Most spell nodes don't
 *     need one; the default fallback (replace the lowest-tier equipped
 *     spell) covers the rest.
 */

export const SKILL_TREES = {
  fire: [
    { id: 'ember_flick',     label: 'Ember Flick',      type: 'spell',   tier: 1,  x: 0.5,  prereqs: [],                          description: 'Tiny fast projectile. Warning shot.' },
    { id: 'spark_shot',      label: 'Spark Shot',       type: 'spell',   tier: 2,  x: 0.15, prereqs: ['ember_flick'],             description: 'Rapid-fire sparks. 0.12s cooldown. Machine-gun fire.' },
    { id: 'kindling',        label: 'Kindling',          type: 'passive', tier: 2,  x: 0.75, prereqs: ['ember_flick'],             description: '+10% damage per Ember Flick hit. Stacks 3×.' },
    { id: 'rune_ember',      label: 'Ember Rune',        type: 'spell',   tier: 2,  x: 0.45, prereqs: ['ember_flick'],             description: 'Place a rune. Detonates on the first enemy to step in it.' },
    { id: 'fireball',        label: 'Fireball',          type: 'spell',   tier: 3,  x: 0.5,  prereqs: ['spark_shot', 'kindling'], description: 'Heavy explosive projectile. The class identity.' },
    { id: 'combustion',      label: 'Combustion',        type: 'passive', tier: 4,  x: 0.5,  prereqs: ['fireball'],               description: 'All fire spells apply burn. Stacks 3×.' },
    { id: 'cauterize',       label: 'Cauterize',         type: 'spell',   tier: 5,  x: 0.5,  prereqs: ['combustion'],             description: 'Beam that slows and disorients.' },
    { id: 'lightning_strike',label: 'Lightning Strike',  type: 'spell',   tier: 6,  x: 0.2,  prereqs: ['cauterize'],              description: 'Telegraphed bolt from above. Stuns briefly.', branchGroup: 'fire_fork', branch: 'lightning' },
    { id: 'static_charge',   label: 'Static Charge',    type: 'passive', tier: 7,  x: 0.2,  prereqs: ['lightning_strike'],        description: 'Lightning hits stun briefly.' },
    { id: 'chain_lightning',  label: 'Chain Lightning',  type: 'spell',   tier: 8,  x: 0.2,  prereqs: ['static_charge'],          description: 'Bounces between 3 enemies.' },
    { id: 'immolate',        label: 'Immolate',          type: 'spell',   tier: 6,  x: 0.8,  prereqs: ['cauterize'],              description: 'Coat yourself in fire. Melee contact burns.', branchGroup: 'fire_fork', branch: 'immolate' },
    { id: 'backdraft',       label: 'Backdraft',         type: 'passive', tier: 7,  x: 0.8,  prereqs: ['immolate'],               description: 'Taking damage while Immolate active explodes.' },
    { id: 'eruption',        label: 'Eruption',          type: 'spell',   tier: 8,  x: 0.8,  prereqs: ['backdraft'],              description: 'Fire pillar erupts beneath target after delay.' },
    { id: 'amaterasu',       label: 'Amaterasu',         type: 'spell',   tier: 9,  x: 0.5,  prereqs: ['chain_lightning', 'eruption'], description: 'Black fire placed ON target. Burns eternally.', shouldReplace: 'cauterize' },
    { id: 'rune_magma',      label: 'Magma Rune',        type: 'spell',   tier: 9.5, x: 0.8, prereqs: ['amaterasu'],               description: 'Powerful rune. Massive damage + burn on trigger.' },
    { id: 'solar_flare',     label: 'Solar Flare',       type: 'passive', tier: 10, x: 0.5,  prereqs: ['amaterasu'],              description: 'Brief flash on hit. Momentary blind.' },
    { id: 'inferno_domain',  label: 'Inferno Domain',    type: 'spell',   tier: 11, x: 0.5,  prereqs: ['solar_flare'],            description: 'Domain: projectiles accelerate toward center. 4s.' },
    { id: 'phoenix',         label: 'Phoenix',           type: 'passive', tier: 12, x: 0.5,  prereqs: ['inferno_domain'],         description: 'Once per life, fatal blow leaves you at 20% HP.' },
    { id: 'god_ray',         label: 'God Ray',           type: 'spell',   tier: 13, x: 0.5,  prereqs: ['phoenix'],                description: 'Hitscan. Concentrated sunlight. Instant. Melts.' },
  ],
  ice: [
    { id: 'frost_bite',      label: 'Frost Bite',        type: 'spell',   tier: 1,  x: 0.5,  prereqs: [],                         description: 'Cone of cold. Minor slow.' },
    { id: 'frost_needle',    label: 'Frost Needle',      type: 'spell',   tier: 2,  x: 0.15, prereqs: ['frost_bite'],             description: 'Rapid-fire ice needles. 0.15s cooldown. Each hit briefly slows.' },
    { id: 'brittle',         label: 'Brittle',           type: 'passive', tier: 2,  x: 0.75, prereqs: ['frost_bite'],             description: 'Slowed enemies take +15% damage.' },
    { id: 'rune_rime',       label: 'Rime Rune',         type: 'spell',   tier: 2,  x: 0.45, prereqs: ['frost_bite'],             description: 'Place a rune. Detonates on the first enemy to step in it.' },
    { id: 'glacial_lob',     label: 'Glacial Lob',       type: 'spell',   tier: 2.5,x: 0.9,  prereqs: ['frost_bite'],             description: 'Lobbed ice boulder. Shatters into a frost-nova slow field.' },
    { id: 'glacial_spike',   label: 'Glacial Spike',     type: 'spell',   tier: 3,  x: 0.5,  prereqs: ['frost_needle', 'brittle'], description: 'Fast piercing spike. The class identity.' },
    { id: 'flash_freeze',    label: 'Flash Freeze',      type: 'passive', tier: 4,  x: 0.5,  prereqs: ['glacial_spike'],          description: 'Two ice spells within 1.5s = briefly frozen.' },
    { id: 'ice_wall',        label: 'Ice Wall',          type: 'spell',   tier: 5,  x: 0.5,  prereqs: ['flash_freeze'],           description: 'Conjure a wall. Blocks projectiles. Shatterable.' },
    { id: 'frost_nova',      label: 'Frost Nova',        type: 'spell',   tier: 6,  x: 0.2,  prereqs: ['ice_wall'],               description: 'Ground pulse freezes nearby enemies 1.5s.', branchGroup: 'ice_fork', branch: 'nova' },
    { id: 'permafrost',      label: 'Permafrost',        type: 'passive', tier: 7,  x: 0.2,  prereqs: ['frost_nova'],             description: 'Ground you walk frosts briefly, slowing pursuers.' },
    { id: 'blizzard',        label: 'Blizzard',          type: 'spell',   tier: 8,  x: 0.2,  prereqs: ['permafrost'],             description: 'Sustained overhead storm. 5s chip damage + slow.' },
    { id: 'shatter',         label: 'Shatter',           type: 'spell',   tier: 6,  x: 0.8,  prereqs: ['ice_wall'],               description: 'Detonate a frozen enemy for massive burst.', branchGroup: 'ice_fork', branch: 'shatter' },
    { id: 'glass_cannon',    label: 'Glass Cannon',      type: 'passive', tier: 7,  x: 0.8,  prereqs: ['shatter'],                description: 'Shattering resets Glacial Spike cooldown.' },
    { id: 'cryo_lance',      label: 'Cryo Lance',        type: 'spell',   tier: 8,  x: 0.8,  prereqs: ['glass_cannon'],           description: 'Enormous slow spike. Triple damage. Wall piercing.' },
    { id: 'cryogenic',       label: 'Cryogenic',         type: 'passive', tier: 9,  x: 0.5,  prereqs: ['blizzard', 'cryo_lance'], description: 'All impacts leave lingering cold zones.' },
    { id: 'rune_glacier',    label: 'Glacier Rune',      type: 'spell',   tier: 9.5, x: 0.8, prereqs: ['cryogenic'],              description: 'Powerful rune. Massive damage + full freeze on trigger.' },
    { id: 'absolute_zero',   label: 'Absolute Zero',     type: 'spell',   tier: 10, x: 0.5,  prereqs: ['cryogenic'],              description: 'Domain: near-total stillness. 3s. Telegraphed.' },
    { id: 'hypothermia',     label: 'Hypothermia',       type: 'passive', tier: 11, x: 0.5,  prereqs: ['absolute_zero'],          description: 'Enemies exiting Absolute Zero stay slowed 2s.' },
    { id: 'divine_judgement',label: 'Divine Judgement',  type: 'spell',   tier: 12, x: 0.5,  prereqs: ['hypothermia'],            description: 'Silent. Perfect. Frozen targets shatter instantly.', shouldReplace: 'frost_needle' },
  ],
  dark: [
    { id: 'void_touch',      label: 'Void Touch',        type: 'spell',   tier: 1,  x: 0.5,  prereqs: [],                          description: 'Short range dark pulse. Cosmically wrong.' },
    { id: 'void_tap',        label: 'Void Tap',          type: 'spell',   tier: 2,  x: 0.15, prereqs: ['void_touch'],              description: 'Point-blank void strike. 0.1s cooldown. Melee pace.' },
    { id: 'unnerving',       label: 'Unnerving Presence',type: 'passive', tier: 2,  x: 0.75, prereqs: ['void_touch'],              description: 'Nearby enemies have degraded movement accuracy.' },
    { id: 'rune_hex',        label: 'Hex Rune',          type: 'spell',   tier: 2,  x: 0.45, prereqs: ['void_touch'],              description: 'Place a rune. Detonates on the first enemy to step in it. Heals you on trigger.' },
    { id: 'hex_bomb',        label: 'Hex Bomb',          type: 'spell',   tier: 2.5,x: 0.9,  prereqs: ['void_touch'],              description: 'Lobbed void orb. Bursts into a pulling tendril zone on hit.' },
    { id: 'soul_drain',      label: 'Soul Drain',        type: 'spell',   tier: 3,  x: 0.5,  prereqs: ['void_tap', 'unnerving'],   description: 'Sustained beam steals health. Roots you. 2s.' },
    { id: 'hollow',          label: 'Hollow',            type: 'passive', tier: 4,  x: 0.5,  prereqs: ['soul_drain'],              description: 'Enemies below 30% HP take +20% dark damage.' },
    { id: 'obliterate',      label: 'Obliterate',        type: 'spell',   tier: 5,  x: 0.5,  prereqs: ['hollow'],                  description: 'Pure destruction. No utility. The void given form.' },
    { id: 'blood_lance',     label: 'Blood Lance',       type: 'spell',   tier: 6,  x: 0.2,  prereqs: ['obliterate'],              description: '(Vampiric) Fast projectile that heals on hit.', branchGroup: 'dark_fork', branch: 'vampiric' },
    { id: 'crimson_hunger',  label: 'Crimson Hunger',    type: 'passive', tier: 7,  x: 0.2,  prereqs: ['blood_lance'],             description: 'Kills restore a burst of HP. Snowballs.' },
    { id: 'blood_nova',      label: 'Blood Nova',        type: 'spell',   tier: 8,  x: 0.2,  prereqs: ['crimson_hunger'],          description: 'Explosion heals for all damage dealt. Self-centered.' },
    { id: 'crimson_veil',    label: 'Crimson Veil',      type: 'passive', tier: 9,  x: 0.2,  prereqs: ['blood_nova'],              description: 'Vampiric kills grant brief damage reduction.' },
    { id: 'void_bloom',      label: 'Void Bloom',        type: 'spell',   tier: 6,  x: 0.8,  prereqs: ['obliterate'],              description: '(Void) Slow orb explodes into void tendrils.', branchGroup: 'dark_fork', branch: 'void' },
    { id: 'entropy',         label: 'Entropy',           type: 'passive', tier: 7,  x: 0.8,  prereqs: ['void_bloom'],              description: 'Each void spell permanently reduces enemy max HP.' },
    { id: 'singularity',     label: 'Singularity',       type: 'spell',   tier: 8,  x: 0.8,  prereqs: ['entropy'],                 description: 'Gravity well pulls projectiles and enemies. 3s.' },
    { id: 'unraveling',      label: 'Unraveling',        type: 'passive', tier: 9,  x: 0.8,  prereqs: ['singularity'],             description: 'Void-affected enemies slow cumulatively.' },
    { id: 'event_horizon',   label: 'Event Horizon',     type: 'spell',   tier: 10, x: 0.5,  prereqs: ['crimson_veil', 'unraveling'], description: 'Domain: gravitational chaos. Pull everything. 4s.' },
    { id: 'rune_soul',       label: 'Soul Rune',         type: 'spell',   tier: 10.5, x: 0.8, prereqs: ['event_horizon'],          description: 'Powerful rune. Massive damage. Heavily heals you on trigger.' },
    { id: 'undying',         label: 'Undying',           type: 'passive', tier: 11, x: 0.5,  prereqs: ['event_horizon'],           description: 'Fatal blow triggers Phase Slip auto. 1HP.' },
    { id: 'null_gaze',       label: 'Null Gaze',         type: 'spell',   tier: 12, x: 0.5,  prereqs: ['undying'],                 description: 'Hitscan through walls. Leaves void trail 3s.' },
    { id: 'the_abyss',       label: 'The Abyss',         type: 'passive', tier: 13, x: 0.5,  prereqs: ['null_gaze'],               description: 'After Null Gaze, next spell is free and instant.' },
    { id: 'death_note',      label: 'Death Note',        type: 'spell',   tier: 14, x: 0.5,  prereqs: ['the_abyss'],               description: 'Write their name. They die. Once per life.' },
  ],
  sword: [
    { id: 'iron_edge',       label: 'Iron Edge',         type: 'spell',   tier: 1,  x: 0.5,  prereqs: [],                          description: 'Quick slash. Crisp. Immediate. No nonsense.' },
    { id: 'quick_cut',       label: 'Quick Cut',         type: 'spell',   tier: 2,  x: 0.15, prereqs: ['iron_edge'],               description: 'Blindingly fast slash. 0.09s cooldown. Almost no pause between swings.' },
    { id: 'footwork',        label: 'Footwork',          type: 'passive', tier: 2,  x: 0.75, prereqs: ['iron_edge'],               description: 'Slightly increased base movement speed.' },
    { id: 'rune_snare',      label: 'Snare Rune',        type: 'spell',   tier: 2,  x: 0.45, prereqs: ['iron_edge'],               description: 'Place a rune. Detonates on the first enemy to step in it.' },
    { id: 'thrown_blade',    label: 'Thrown Blade',      type: 'spell',   tier: 2.5,x: 0.9,  prereqs: ['iron_edge'],               description: 'Hard-thrown spinning blade. Flat, fast arc.' },
    { id: 'bladestorm',      label: 'Bladestorm',        type: 'spell',   tier: 3,  x: 0.5,  prereqs: ['quick_cut', 'footwork'],   description: 'Spinning blades in spread arc. Punishes dashes.' },
    { id: 'keen_edge',       label: 'Keen Edge',         type: 'passive', tier: 4,  x: 0.5,  prereqs: ['bladestorm'],              description: 'Every 5th spell hit deals double damage.' },
    { id: 'phantom_blade',   label: 'Phantom Blade',     type: 'spell',   tier: 5,  x: 0.5,  prereqs: ['keen_edge'],               description: 'Orbiting sword mirrors next 2 casts.' },
    { id: 'parry',           label: 'Parry',             type: 'spell',   tier: 6,  x: 0.2,  prereqs: ['phantom_blade'],           description: 'Reflects the next incoming projectile back.', branchGroup: 'sword_fork', branch: 'parry' },
    { id: 'counter',         label: 'Counter',           type: 'passive', tier: 7,  x: 0.2,  prereqs: ['parry'],                   description: 'Parry resets Iron Edge. Free empowered slash.' },
    { id: 'riposte',         label: 'Riposte',           type: 'spell',   tier: 8,  x: 0.2,  prereqs: ['counter'],                 description: 'After parry, teleport-lunge to sender.' },
    { id: 'blade_rain',      label: 'Blade Rain',        type: 'spell',   tier: 6,  x: 0.8,  prereqs: ['phantom_blade'],           description: 'Dozens of blades fall in a zone. Denial.', branchGroup: 'sword_fork', branch: 'blade_rain' },
    { id: 'iron_will',       label: 'Iron Will',         type: 'passive', tier: 7,  x: 0.8,  prereqs: ['blade_rain'],              description: 'Warlord spells grant -5% incoming damage 3s.' },
    { id: 'siege_blade',     label: 'Siege Blade',       type: 'spell',   tier: 8,  x: 0.8,  prereqs: ['iron_will'],               description: 'Enormous slow blade. Destroys Ice Walls.' },
    { id: 'razors_edge',     label: "Razor's Edge",      type: 'passive', tier: 9,  x: 0.5,  prereqs: ['riposte', 'siege_blade'],  description: "Phantom Blade mirrors 3 casts. Parry resets Keen Edge." },
    { id: 'rune_executioner',label: "Executioner's Rune",type: 'spell',   tier: 9.5, x: 0.8, prereqs: ['razors_edge'],             description: 'Powerful rune. Massive damage + long stun on trigger.' },
    { id: 'sovereign_cut',   label: 'Sovereign Cut',     type: 'spell',   tier: 10, x: 0.5,  prereqs: ['razors_edge'],             description: 'Enormous telegraphed strike. Devastating if it lands.' },
    { id: 'inevitable',      label: 'Inevitable',        type: 'passive', tier: 11, x: 0.5,  prereqs: ['sovereign_cut'],           description: 'Sovereign Cut CD reduces 2s per spell hit after last.' },
    { id: 'the_last_word',   label: 'The Last Word',     type: 'spell',   tier: 12, x: 0.5,  prereqs: ['inevitable'],              description: 'Domain: time slows for all but you. 3s.' },
    { id: 'final_form',      label: 'Final Form',        type: 'passive', tier: 13, x: 0.5,  prereqs: ['the_last_word'],           description: 'During The Last Word, every hit is double.' },
    { id: 'gods_edge',       label: "God's Edge",        type: 'spell',   tier: 14, x: 0.5,  prereqs: ['final_form'],              description: 'Hitscan. Cuts clean. Bypasses Parry.' },
  ],
  druid: [
    { id: 'thorn_dart',      label: 'Thorn Dart',        type: 'spell',   tier: 1,  x: 0.5,  prereqs: [],                          description: 'Small fast thorn. Humble. Accurate. Do not underestimate.' },
    { id: 'seed_burst',      label: 'Seed Burst',        type: 'spell',   tier: 2,  x: 0.15, prereqs: ['thorn_dart'],              description: '3-shot scatter burst. 0.18s cooldown. Fires rapidly, punishes close range.' },
    { id: 'thick_bark',      label: 'Thick Bark',        type: 'passive', tier: 2,  x: 0.75, prereqs: ['thorn_dart'],              description: '-5% damage received. -10% below half HP.' },
    { id: 'rune_root',       label: 'Root Rune',         type: 'spell',   tier: 2,  x: 0.45, prereqs: ['thorn_dart'],              description: 'Place a rune. Detonates on the first enemy to step in it.' },
    { id: 'spore_pod',       label: 'Spore Pod',         type: 'spell',   tier: 2.5,x: 0.9,  prereqs: ['thorn_dart'],              description: 'Lobbed seed pod. Blooms into a brief entangling root patch.' },
    { id: 'bramble_burst',   label: 'Bramble Burst',     type: 'spell',   tier: 3,  x: 0.5,  prereqs: ['seed_burst', 'thick_bark'], description: 'Thorny eruption at target after 0.4s. Punishes predictability.' },
    { id: 'deep_roots',      label: 'Deep Roots',        type: 'passive', tier: 4,  x: 0.5,  prereqs: ['bramble_burst'],           description: 'Root network senses movement through nearby walls.' },
    { id: 'root_snare',      label: 'Root Snare',        type: 'spell',   tier: 5,  x: 0.5,  prereqs: ['deep_roots'],              description: 'Encases enemy in living wood 2.5s. Full CC. Long cast.' },
    { id: 'undergrowth',     label: 'Undergrowth',       type: 'passive', tier: 6,  x: 0.5,  prereqs: ['root_snare'],              description: 'Each cast increases defense. Stacks 4×. Resets on hit.' },
    { id: 'overgrowth_ward', label: 'Overgrowth Ward',   type: 'passive', tier: 7,  x: 0.2,  prereqs: ['undergrowth'],             description: 'Barriers gain +50% health. Bark Ward absorbs more the lower your HP.', branchGroup: 'druid_fork', branch: 'overgrowth' },
    { id: 'feral_focus',     label: 'Feral Focus',       type: 'passive', tier: 7,  x: 0.8,  prereqs: ['undergrowth'],             description: '+15% damage on Avalanche and Fissure. Offense over defense.', branchGroup: 'druid_fork', branch: 'feral' },
    { id: 'avalanche',       label: 'Avalanche',         type: 'spell',   tier: 8,  x: 0.5,  prereqs: ['overgrowth_ward', 'feral_focus'], description: 'Massive rolling boulder. Staggers. Ancient and unstoppable.' },
    { id: 'rooted',          label: 'Rooted',            type: 'passive', tier: 9,  x: 0.5,  prereqs: ['avalanche'],               description: 'Standing still 1.5s: +20% damage, reduced spell cost.' },
    { id: 'fissure',         label: 'Fissure',           type: 'spell',   tier: 10, x: 0.5,  prereqs: ['rooted'],                  description: 'Split ground in a line. Airborne = +25% damage taken.' },
    { id: 'overgrown',       label: 'Overgrown',         type: 'passive', tier: 11, x: 0.5,  prereqs: ['fissure'],                 description: 'After Root Snare breaks, enemy stays slowed 4s.' },
    { id: 'rune_seismic',    label: 'Seismic Rune',      type: 'spell',   tier: 11.5, x: 0.8, prereqs: ['overgrown'],              description: 'Powerful rune. Massive damage + stun in a huge radius.' },
    { id: 'wildwood_domain', label: 'Wildwood Domain',   type: 'spell',   tier: 12, x: 0.5,  prereqs: ['overgrown'],               description: 'Domain: roots erupt randomly. 5s. You are immune.' },
    { id: 'overgrowth_pulse',label: 'Overgrowth Pulse',  type: 'passive', tier: 13, x: 0.5,  prereqs: ['wildwood_domain'],         description: 'Root Launch automatically triggers a small Bramble Burst.' },
    { id: 'verdant_lance',   label: 'Verdant Lance',     type: 'spell',   tier: 14, x: 0.5,  prereqs: ['overgrowth_pulse'],        description: 'Hitscan. Visible 1s before firing. Hits like a falling tree.', shouldReplace: 'bramble_burst' },
  ],
  crystalmancer: [
    { id: 'crystal_shard',   label: 'Crystal Shard',     type: 'spell',   tier: 1,  x: 0.5,  prereqs: [],                          description: 'Small fast shard. Humble. Accurate. Do not underestimate.' },
    { id: 'shard_burst',     label: 'Shard Burst',       type: 'spell',   tier: 2,  x: 0.15, prereqs: ['crystal_shard'],           description: '3-shot scatter burst. 0.18s cooldown. Fires rapidly, punishes close range.' },
    { id: 'tremor_sense',    label: 'Tremor Sense',      type: 'passive', tier: 2,  x: 0.75, prereqs: ['crystal_shard'],           description: 'Resonance through the crystal lattice reveals footsteps through nearby walls.' },
    { id: 'rune_shard',      label: 'Shard Rune',        type: 'spell',   tier: 2,  x: 0.45, prereqs: ['crystal_shard'],           description: 'Place a rune. Detonates on the first enemy to step in it.' },
    { id: 'geode_bomb',      label: 'Geode Bomb',        type: 'spell',   tier: 2.5,x: 0.9,  prereqs: ['crystal_shard'],           description: 'Lobbed crystal. Falls fast and shatters into shrapnel.' },
    { id: 'crystal_spire',   label: 'Crystal Spire',     type: 'spell',   tier: 3,  x: 0.5,  prereqs: ['shard_burst', 'tremor_sense'], description: 'Erupts at target after 0.4s. Punishes predictability.' },
    { id: 'geologic',        label: 'Geologic',          type: 'passive', tier: 4,  x: 0.5,  prereqs: ['crystal_spire'],           description: 'Each cast increases defense. Stacks 4×. Resets on hit.' },
    { id: 'crystal_wall',    label: 'Crystal Wall',      type: 'spell',   tier: 5,  x: 0.5,  prereqs: ['geologic'],                description: 'Crystalline wall. Tougher than Ice Wall. 15s duration.' },
    { id: 'resonance',       label: 'Resonance',         type: 'passive', tier: 6,  x: 0.5,  prereqs: ['crystal_wall'],            description: 'Consecutive crystal-spell hits build a stacking damage buff. Decays.' },
    { id: 'prismatic_ward',  label: 'Prismatic Ward',    type: 'passive', tier: 7,  x: 0.2,  prereqs: ['resonance'],               description: 'Barriers gain +50% health. Small chance to reflect projectiles.', branchGroup: 'crystal_fork', branch: 'prismatic' },
    { id: 'shattering_focus',label: 'Shattering Focus',  type: 'passive', tier: 7,  x: 0.8,  prereqs: ['resonance'],               description: '+15% damage on Geode Bomb and Shard Fracture. Offense over defense.', branchGroup: 'crystal_fork', branch: 'shattering' },
    { id: 'petrify',         label: 'Petrify',           type: 'spell',   tier: 8,  x: 0.5,  prereqs: ['prismatic_ward', 'shattering_focus'], description: 'Encases enemy in crystal 2.5s. Full CC. Long cast.' },
    { id: 'fossilize',       label: 'Fossilize',         type: 'passive', tier: 9,  x: 0.5,  prereqs: ['petrify'],                 description: 'After Petrify breaks, enemy stays slowed 4s.' },
    { id: 'shard_fracture',  label: 'Shard Fracture',    type: 'spell',   tier: 10, x: 0.5,  prereqs: ['fossilize'],               description: 'Split ground in a line of shards. Airborne = +25% damage taken.' },
    { id: 'prism_field',     label: 'Prism Field',       type: 'spell',   tier: 11, x: 0.5,  prereqs: ['shard_fracture'],          description: 'Domain: crystal spires erupt randomly. 5s. You are immune.' },
    { id: 'rune_prism',      label: 'Prism Rune',        type: 'spell',   tier: 11.5, x: 0.8, prereqs: ['prism_field'],            description: 'Powerful rune. Massive damage + stun in a huge radius.' },
    { id: 'crystalline_growth', label: 'Crystalline Growth', type: 'passive', tier: 12, x: 0.5, prereqs: ['prism_field'],          description: 'After Prism Field, Resonance activates instantly.' },
    { id: 'the_monolith',    label: 'The Monolith',      type: 'spell',   tier: 13, x: 0.5,  prereqs: ['crystalline_growth'],      description: 'Hitscan. Visible 1s before firing. Hits like geology.', shouldReplace: 'crystal_spire' },
  ],
};

/** true if every listed prereq exists as a node id somewhere in the tree -- sanity check, not called in hot paths. */
export function getTree(wizardClass) {
  return SKILL_TREES[wizardClass] ?? [];
}

export function getNode(wizardClass, nodeId) {
  return getTree(wizardClass).find((n) => n.id === nodeId) ?? null;
}

/** Same semantics as the client's existing canBuy: no prereqs, or ANY prereq already unlocked. */
export function canUnlockNode(node, unlockedSet) {
  if (unlockedSet.has(node.id)) return false;
  if (node.prereqs.length === 0) return true;
  return node.prereqs.some((p) => unlockedSet.has(p));
}

/** The branchGroup's two sibling nodes, in declared order, or null if the class has none. */
export function getForkPair(wizardClass, branchGroup) {
  const siblings = getTree(wizardClass).filter((n) => n.branchGroup === branchGroup);
  return siblings.length === 2 ? siblings : null;
}
