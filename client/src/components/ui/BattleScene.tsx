/**
 * Pokemon-battle-style spell preview for the pause menu. Camera sits behind
 * the local wizard's shoulder (back turned to us, same as a Pokemon "your
 * mon" view) looking across the arena at an enemy wizard standing where the
 * opposing Pokemon would be. Hovering a castable spell in the Spells/Glossary
 * tab plays that spell's casting animation on the local wizard and a matching
 * "struck" reaction on the enemy; every time the loop completes it advances
 * the enemy to the next class in rotation (every class except your own).
 *
 * All animation is driven imperatively off elapsed time modulo the current
 * spell's total cycle duration (see CAST_PROFILES) inside useFrame, rather
 * than React state/useEffect timers -- keeps it glitch-free across rapid
 * hover changes and avoids re-rendering the scene every frame.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SpellDef, SpellType, WizardClass } from '../../types/game.types';

/** A plain mutable ref cell -- used instead of number props for anything that
 * changes every animation frame, so consumers can read the latest value from
 * their own useFrame without waiting on a React re-render (see useCastAnimation
 * / ArmAndWand elsewhere for the same pattern). */
type FrameRef<T> = { current: T };

const CLASS_COLORS: Record<WizardClass, string> = {
  fire: '#ff4500', ice: '#a0d8ff', dark: '#cc00ff', sword: '#c8c8c8', druid: '#5a9e3d', crystalmancer: '#8fd4ff',
};
const ALL_CLASSES: WizardClass[] = ['fire', 'ice', 'dark', 'sword', 'druid', 'crystalmancer'];

const HAT_CONE_RADIUS = 0.28;
const HAT_CONE_HEIGHT = 0.5;
const HAT_BASE_LOCAL_Y = 1.95;
const REST_PITCH = 0.35;

// Both wizards are angled toward each other rather than square-on, so the
// stance reads as a dynamic face-off instead of two flat cutouts.
const LOCAL_YAW = -0.42;
const ENEMY_YAW = Math.PI + 0.4;
const LOCAL_WIZARD_POS = new THREE.Vector3(-0.7, 0, 1.0);
const ENEMY_POS = new THREE.Vector3(0.85, 0, -3.3);

type CastVisual = 'orb' | 'beam' | 'flash' | 'ring' | 'dome' | 'lunge' | 'rune';

interface CastProfile {
  windup: number; cast: number; recover: number; pause: number;
  impactAt: number; // ms from cycle start the enemy flinch peaks (start of a repeating window for 'beam')
  visual: CastVisual;
  upPose: number; downPose: number; // arm pitch targets -- more negative = raised, more positive = dipped down
  yawSweep: number; // side-to-side arm sweep during cast, per visual character
}

// One profile per equippable spell type (mobility/passive never reach here --
// isEquippableSpell filters them out of the grid this scene is driven from).
const CAST_PROFILES: Record<Exclude<SpellType, 'mobility' | 'passive' | 'defensive'>, CastProfile> = {
  projectile: { windup: 550, cast: 220, recover: 380, pause: 650, impactAt: 550 + 220 + 380, visual: 'orb', upPose: -0.95, downPose: 1.05, yawSweep: 0 },
  arc:        { windup: 550, cast: 220, recover: 380, pause: 650, impactAt: 550 + 220 + 380, visual: 'orb', upPose: -0.95, downPose: 1.05, yawSweep: 0 },
  hitscan:    { windup: 380, cast: 130, recover: 320, pause: 700, impactAt: 380 + 130, visual: 'flash', upPose: -0.8, downPose: 1.0, yawSweep: 0 },
  direct:     { windup: 380, cast: 130, recover: 320, pause: 700, impactAt: 380 + 130, visual: 'flash', upPose: -0.8, downPose: 0.95, yawSweep: 0 },
  beam:       { windup: 420, cast: 950, recover: 380, pause: 650, impactAt: 420, visual: 'beam', upPose: -0.85, downPose: 0.55, yawSweep: 0.06 },
  aoe:        { windup: 680, cast: 320, recover: 420, pause: 750, impactAt: 680 + 320, visual: 'ring', upPose: -1.25, downPose: 1.1, yawSweep: 0 },
  domain:     { windup: 1150, cast: 480, recover: 550, pause: 900, impactAt: 1150 + 480, visual: 'dome', upPose: -1.35, downPose: 0.95, yawSweep: 0.9 },
  melee:      { windup: 190, cast: 190, recover: 300, pause: 620, impactAt: 190 + 150, visual: 'lunge', upPose: -0.5, downPose: 0.5, yawSweep: 1.3 },
  rune:       { windup: 420, cast: 260, recover: 320, pause: 950, impactAt: 420 + 260 + 500, visual: 'rune', upPose: -0.6, downPose: 1.5, yawSweep: 0 },
};

function cycleDuration(p: CastProfile): number {
  return p.windup + p.cast + p.recover + p.pause;
}

function easeOutCubic(x: number) { return 1 - Math.pow(1 - x, 3); }
function easeInCubic(x: number) { return x * x * x; }
function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

/** Arm rig pitch/yaw/push for the local wizard at time `t` within one cycle. */
function computeLocalPose(profile: CastProfile, t: number): [number, number, number] {
  const { windup, cast, upPose, downPose, yawSweep, visual } = profile;
  if (t < windup) {
    const p = easeOutCubic(clamp01(t / windup));
    const yaw = visual === 'dome' ? Math.sin(p * Math.PI * 2) * yawSweep * 0.4 : 0;
    return [REST_PITCH + (upPose - REST_PITCH) * p, yaw, 0];
  }
  if (t < windup + cast) {
    const p = clamp01((t - windup) / cast);
    if (visual === 'beam') {
      // Channel: snap down once, then hold with a light tremor for the rest of the cast window.
      const snap = easeOutCubic(Math.min(1, p * 4));
      const held = downPose;
      const pitch = p < 0.25 ? upPose + (held - upPose) * snap : held;
      return [pitch, Math.sin(t * 0.012) * yawSweep, 0];
    }
    if (visual === 'lunge') {
      const swing = Math.sin(p * Math.PI);
      return [REST_PITCH - swing * 0.6, (p < 0.5 ? -1 : 1) * swing * yawSweep, swing * 0.4];
    }
    const snap = easeInCubic(p);
    const yaw = visual === 'dome' ? Math.sin(Math.PI + p * Math.PI) * yawSweep * 0.5 : 0;
    return [upPose + (downPose - upPose) * snap, yaw, visual === 'orb' || visual === 'ring' ? snap * 0.25 : 0];
  }
  const { recover } = profile;
  const p = easeOutCubic(clamp01((t - windup - cast) / recover));
  return [downPose + (REST_PITCH - downPose) * p, 0, 0];
}

/** 0..1 "how hard is the enemy flinching right now" -- a bell curve around impactAt, or a repeating one for 'beam'. */
function computeFlinch(profile: CastProfile, t: number): number {
  if (profile.visual === 'beam') {
    if (t < profile.impactAt || t > profile.impactAt + profile.cast) return 0;
    return 0.35 + 0.35 * (0.5 + 0.5 * Math.sin((t - profile.impactAt) * 0.03));
  }
  const dt = t - profile.impactAt;
  const width = profile.visual === 'dome' ? 260 : 120;
  return Math.exp(-((dt / width) ** 2));
}

interface WizardBodyProps {
  color: string;
  hatScale?: number;
}

/** Shared capsule + head + hat, no arm -- used for both wizards; arm is composed separately since the two need very different rigs. */
function WizardBody({ color, hatScale = 1 }: WizardBodyProps) {
  return (
    <>
      <mesh position={[0, 0.9, 0]} castShadow>
        <capsuleGeometry args={[0.35, 1.0, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.75, 0]} castShadow>
        <sphereGeometry args={[0.3, 8, 8]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.2} />
      </mesh>
      <group position={[0, HAT_BASE_LOCAL_Y, 0]} scale={[hatScale, hatScale, hatScale]}>
        <mesh position={[0, HAT_CONE_HEIGHT / 2, 0]} castShadow>
          <coneGeometry args={[HAT_CONE_RADIUS, HAT_CONE_HEIGHT, 12]} />
          <meshStandardMaterial color={color} roughness={0.45} metalness={0.2} />
        </mesh>
      </group>
    </>
  );
}

interface LocalWizardProps {
  color: string;
  gemColor: string;
  profile: CastProfile | null;
  cycleTRef: FrameRef<number>;
}

/** The player's own wizard, back to camera, arm rig driven by the active cast profile. Reads cycleTRef every frame so it stays smooth regardless of how often the parent re-renders. */
function LocalWizard({ color, gemColor, profile, cycleTRef }: LocalWizardProps) {
  const rigRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const gemMatRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(() => {
    const [pitch, yaw, push] = profile ? computeLocalPose(profile, cycleTRef.current) : [REST_PITCH, 0, 0];
    if (rigRef.current) {
      rigRef.current.rotation.x = pitch;
      rigRef.current.rotation.y = yaw;
    }
    if (bodyRef.current) {
      // Melee lunges the whole body forward, not just the arm -- relative to
      // its base Z, not an absolute override (that would erase the base offset).
      const lungeZ = profile?.visual === 'lunge' ? -push * 0.5 : 0;
      bodyRef.current.position.z = LOCAL_WIZARD_POS.z + lungeZ;
    }
    if (gemMatRef.current) {
      gemMatRef.current.emissiveIntensity = profile ? 1.6 : 0.4;
    }
  });

  return (
    <group ref={bodyRef} position={LOCAL_WIZARD_POS} rotation={[0, LOCAL_YAW, 0]}>
      <WizardBody color={color} />
      <pointLight position={[0, 1.5, 0.6]} intensity={0.55} distance={4} color={color} />
      <group position={[0.3, 1.3, 0]}>
        <group ref={rigRef} rotation={[REST_PITCH, 0, 0]}>
          <mesh position={[0, 0, -0.15]} rotation={[-Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.07, 0.08, 0.3, 6]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0, -0.55]} rotation={[-Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.02, 0.035, 0.55, 6]} />
            <meshStandardMaterial color="#2a1a10" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0, -0.86]}>
            <sphereGeometry args={[0.055, 8, 8]} />
            <meshStandardMaterial ref={gemMatRef} color={gemColor} emissive={gemColor} emissiveIntensity={0.4} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

interface EnemyWizardProps {
  color: string;
  spellColor: string;
  profile: CastProfile | null;
  cycleTRef: FrameRef<number>;
}

function EnemyWizard({ color, spellColor, profile, cycleTRef }: EnemyWizardProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const headMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const armRigRef = useRef<THREE.Group>(null);
  const gemMatRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((state) => {
    const flinch = profile ? computeFlinch(profile, cycleTRef.current) : 0;
    if (groupRef.current) {
      const bob = Math.sin(state.clock.elapsedTime * 1.6) * 0.02;
      groupRef.current.position.set(ENEMY_POS.x, bob + flinch * -0.06, ENEMY_POS.z + flinch * 0.18);
      const wobble = Math.sin(state.clock.elapsedTime * 40) * flinch * 0.08;
      groupRef.current.rotation.z = wobble;
    }
    for (const mat of [bodyMatRef.current, headMatRef.current]) {
      if (!mat) continue;
      mat.emissive.set(spellColor);
      mat.emissiveIntensity = flinch * 1.8;
    }
    // A little defensive flinch of their own wand arm when struck, otherwise resting.
    if (armRigRef.current) {
      armRigRef.current.rotation.x = REST_PITCH - flinch * 0.5;
    }
    if (gemMatRef.current) {
      gemMatRef.current.emissiveIntensity = 0.4 + flinch * 1.4;
    }
  });

  return (
    <group ref={groupRef} rotation={[0, ENEMY_YAW, 0]}>
      <mesh position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.35, 1.0, 4, 8]} />
        <meshStandardMaterial ref={bodyMatRef} color={color} roughness={0.7} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.75, 0]}>
        <sphereGeometry args={[0.3, 8, 8]} />
        <meshStandardMaterial ref={headMatRef} color={color} roughness={0.6} metalness={0.2} />
      </mesh>
      <group position={[0, HAT_BASE_LOCAL_Y, 0]}>
        <mesh position={[0, HAT_CONE_HEIGHT / 2, 0]}>
          <coneGeometry args={[HAT_CONE_RADIUS, HAT_CONE_HEIGHT, 12]} />
          <meshStandardMaterial color={color} roughness={0.45} metalness={0.2} />
        </mesh>
      </group>

      {/* Arm + wand, mirroring the local wizard's rig -- every mage carries one. */}
      <group position={[0.3, 1.3, 0]}>
        <group ref={armRigRef} rotation={[REST_PITCH, 0, 0]}>
          <mesh position={[0, 0, -0.15]} rotation={[-Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.07, 0.08, 0.3, 6]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0, -0.55]} rotation={[-Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.02, 0.035, 0.55, 6]} />
            <meshStandardMaterial color="#2a1a10" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0, -0.86]}>
            <sphereGeometry args={[0.055, 8, 8]} />
            <meshStandardMaterial ref={gemMatRef} color={color} emissive={color} emissiveIntensity={0.4} />
          </mesh>
        </group>
      </group>

      <pointLight position={[0, 1.4, -0.4]} intensity={0.4} distance={3} color={color} />
    </group>
  );
}

// Approximate wand-tip world position at rest, rotated the same LOCAL_YAW as
// the body -- the VFX origin doesn't need to track the animated arm exactly,
// just start from roughly the right place now that the body is angled.
const WAND_TIP_LOCAL = new THREE.Vector3(0.3, 1.3 - 0.86 * 0.35, -0.86)
  .applyAxisAngle(new THREE.Vector3(0, 1, 0), LOCAL_YAW)
  .add(LOCAL_WIZARD_POS);

interface CastVfxProps {
  spell: SpellDef;
  profile: CastProfile;
  cycleTRef: FrameRef<number>;
}

/** The projectile/beam/ring/dome/rune visual that reads as "casting at the enemy". */
function CastVfx({ spell, profile, cycleTRef }: CastVfxProps) {
  const orbRef = useRef<THREE.Mesh>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const domeRef = useRef<THREE.Mesh>(null);
  const runeRef = useRef<THREE.Group>(null);

  const start = WAND_TIP_LOCAL;
  const end = useMemo(() => new THREE.Vector3(ENEMY_POS.x, 1.2, ENEMY_POS.z), []);
  const mid = useMemo(() => start.clone().lerp(end, 0.5), [start, end]);
  const dist = start.distanceTo(end);

  useFrame(() => {
    const { windup, cast, recover, visual, impactAt } = profile;
    const t = cycleTRef.current;

    if (orbRef.current) {
      const travelStart = windup;
      const travelEnd = impactAt;
      const active = visual === 'orb' && t >= travelStart && t <= travelEnd + 80;
      orbRef.current.visible = active;
      if (active) {
        const p = clamp01((t - travelStart) / (travelEnd - travelStart));
        orbRef.current.position.lerpVectors(start, end, easeInCubic(p));
        const s = 1 - Math.max(0, p - 0.9) * 5;
        orbRef.current.scale.setScalar(Math.max(0.3, s));
      }
    }

    if (beamRef.current) {
      const active = visual === 'beam' && t >= windup && t < windup + cast;
      beamRef.current.visible = active;
      if (active) {
        beamRef.current.position.copy(mid);
        beamRef.current.lookAt(end);
        beamRef.current.rotateX(Math.PI / 2);
        const mat = beamRef.current.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.55 + 0.35 * Math.sin(t * 0.05);
      }
    }

    if (ringRef.current) {
      const rStart = windup + cast * 0.3;
      const rEnd = windup + cast + recover * 0.6;
      const active = visual === 'ring' && t >= rStart && t <= rEnd;
      ringRef.current.visible = active;
      if (active) {
        const p = clamp01((t - rStart) / (rEnd - rStart));
        const scale = 0.15 + p * 1.1;
        ringRef.current.scale.set(scale, scale, scale);
        (ringRef.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - p);
      }
    }

    if (domeRef.current) {
      const dStart = windup + cast * 0.5;
      const dEnd = windup + cast + recover;
      const active = visual === 'dome' && t >= dStart && t <= dEnd;
      domeRef.current.visible = active;
      if (active) {
        const p = clamp01((t - dStart) / (dEnd - dStart));
        const scale = 0.4 + p * 2.6;
        domeRef.current.scale.set(scale, scale * 0.7, scale);
        (domeRef.current.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - p);
      }
    }

    if (runeRef.current) {
      const runeStart = windup + cast * 0.5;
      const detonateAt = profile.impactAt;
      const runeEnd = detonateAt + 250;
      const active = visual === 'rune' && t >= runeStart && t <= runeEnd;
      runeRef.current.visible = active;
      if (active) {
        const pulse = 1 + Math.sin(t * 0.02) * 0.08;
        const blast = t > detonateAt ? 1 + ((t - detonateAt) / 250) * 1.8 : 1;
        runeRef.current.scale.setScalar(pulse * blast);
        const mesh = runeRef.current.children[0] as THREE.Mesh;
        const mat = mesh?.material as THREE.MeshBasicMaterial | undefined;
        if (mat) mat.opacity = t > detonateAt ? Math.max(0, 1 - (t - detonateAt) / 250) : 0.85;
      }
    }
  });

  return (
    <>
      <mesh ref={orbRef} visible={false}>
        <sphereGeometry args={[0.11, 10, 10]} />
        <meshStandardMaterial color={spell.color} emissive={spell.glowColor} emissiveIntensity={2} />
      </mesh>
      <mesh ref={beamRef} visible={false}>
        <cylinderGeometry args={[0.045, 0.045, dist, 8, 1, true]} />
        <meshBasicMaterial color={spell.glowColor} transparent opacity={0.6} />
      </mesh>
      <mesh ref={ringRef} position={[end.x, 0.02, end.z]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.5, 0.68, 32]} />
        <meshBasicMaterial color={spell.glowColor} transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={domeRef} position={[end.x, 0.9, end.z]} visible={false}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color={spell.glowColor} transparent opacity={0} wireframe />
      </mesh>
      <group ref={runeRef} position={[mid.x, 0.03, mid.z]} rotation={[-Math.PI / 2, 0, Math.PI / 4]} visible={false}>
        <mesh>
          <planeGeometry args={[0.5, 0.5]} />
          <meshBasicMaterial color={spell.glowColor} transparent opacity={0} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  );
}

interface SceneInnerProps {
  myClass: WizardClass;
  hoveredSpell: SpellDef | null;
  idleGemColor: string;
}

function SceneInner({ myClass, hoveredSpell, idleGemColor }: SceneInnerProps) {
  const myColor = CLASS_COLORS[myClass];
  const enemyClasses = useMemo(() => ALL_CLASSES.filter((c) => c !== myClass), [myClass]);

  const timelineStart = useRef(Date.now());
  useEffect(() => { timelineStart.current = Date.now(); }, [hoveredSpell?.id]);

  const cycleTRef = useRef(0);
  const enemyIdxRef = useRef(0);
  const [enemyColor, setEnemyColor] = useState(CLASS_COLORS[enemyClasses[0]]);

  const profile = hoveredSpell ? CAST_PROFILES[hoveredSpell.type as keyof typeof CAST_PROFILES] ?? null : null;
  const gemColor = hoveredSpell ? hoveredSpell.color : idleGemColor;

  useFrame(() => {
    if (!profile) { cycleTRef.current = 0; return; }
    const total = cycleDuration(profile);
    const elapsed = Date.now() - timelineStart.current;
    const cycle = Math.floor(elapsed / total);
    cycleTRef.current = elapsed - cycle * total;
    const idx = cycle % enemyClasses.length;
    if (idx !== enemyIdxRef.current) {
      enemyIdxRef.current = idx;
      setEnemyColor(CLASS_COLORS[enemyClasses[idx]]);
    }
  });

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[2, 5, 3]} intensity={0.6} />

      {/* Ground discs for grounding */}
      <mesh position={[-0.55, 0.01, 1.0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.62, 32]} />
        <meshBasicMaterial color={myColor} transparent opacity={0.1} />
      </mesh>
      <mesh position={[ENEMY_POS.x, 0.01, ENEMY_POS.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.5, 32]} />
        <meshBasicMaterial color={enemyColor} transparent opacity={0.08} />
      </mesh>

      <LocalWizard color={myColor} gemColor={gemColor} profile={profile} cycleTRef={cycleTRef} />
      <EnemyWizard color={enemyColor} spellColor={hoveredSpell?.glowColor ?? '#ffffff'} profile={profile} cycleTRef={cycleTRef} />
      {hoveredSpell && profile && <CastVfx spell={hoveredSpell} profile={profile} cycleTRef={cycleTRef} />}
    </>
  );
}

interface BattleSceneProps {
  myClass: WizardClass | null;
  hoveredSpell: SpellDef | null;
  idleGemColor: string;
}

export function BattleScene({ myClass, hoveredSpell, idleGemColor }: BattleSceneProps) {
  if (!myClass) return null;
  return (
    <Canvas
      camera={{ fov: 34, position: [-1.0, 2.5, 5.7] }}
      gl={{ antialias: true }}
      style={{ width: '100%', height: '100%' }}
      onCreated={({ camera }) => camera.lookAt(0.05, 1.25, -1.0)}
    >
      <Suspense fallback={null}>
        <SceneInner myClass={myClass} hoveredSpell={hoveredSpell} idleGemColor={idleGemColor} />
      </Suspense>
    </Canvas>
  );
}
