/**
 * Chain Lightning's connect-the-dots visual: a jagged, crackling bolt that
 * actually passes through the caster and every bounce target in sequence,
 * instead of the old fixed-length straight tracer per segment (which never
 * reached the actual bounce point, and only ever pointed in the aim
 * direction). Re-jitters its path a few times over its short lifetime for a
 * crackling "electricity" look.
 */

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EffectState } from '../../types/game.types';
import { useGameStore } from '../../stores/gameStore';
import { wandTipWorldPosition } from '../../utils/wandTip';
import { buildJaggedPath } from '../../utils/jaggedLine';

const SEGMENTS_PER_LEG = 7;
const JITTER = 0.4;
const REJITTER_INTERVAL_MS = 55;

export function ChainLightningArc({ effect }: { effect: EffectState }) {
  const lastJitterRef = useRef(0);

  const players = useGameStore((s) => s.players);
  const owner = players[effect.ownerId];

  const basePoints = useMemo(() => {
    if (!effect.points || effect.points.length < 2) return null;
    const pts = effect.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    // Replace the first point (raw eye-level position from the server) with
    // the wand tip, same treatment as HitscanFlash/BeamSpell.
    if (owner) {
      const tip = wandTipWorldPosition(owner.position, owner.yaw);
      pts[0].set(tip.x, tip.y, tip.z);
    }
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect.points, owner?.position.x, owner?.position.y, owner?.position.z, owner?.yaw]);

  const scene = useMemo(() => {
    const color = effect.color ?? '#ffe066';
    const glowColor = effect.glowColor ?? '#ffffff';
    const coreGeo = new THREE.BufferGeometry();
    const glowGeo = new THREE.BufferGeometry();
    const coreMat = new THREE.LineBasicMaterial({ color: glowColor, transparent: true, opacity: 1 });
    const glowMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 });
    return {
      coreGeo, glowGeo, coreMat, glowMat,
      coreLine: new THREE.Line(coreGeo, coreMat),
      glowLine: new THREE.Line(glowGeo, glowMat),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect.id]);

  useEffect(() => () => {
    scene.coreGeo.dispose();
    scene.glowGeo.dispose();
    scene.coreMat.dispose();
    scene.glowMat.dispose();
  }, [scene]);

  useFrame(() => {
    if (!basePoints) return;
    const now = Date.now();

    if (now - lastJitterRef.current > REJITTER_INTERVAL_MS) {
      lastJitterRef.current = now;
      const positions = buildJaggedPath(basePoints, SEGMENTS_PER_LEG, JITTER);
      scene.coreGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      scene.glowGeo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
      scene.coreGeo.attributes.position.needsUpdate = true;
      scene.glowGeo.attributes.position.needsUpdate = true;
    }

    const total = effect.expiresAt - effect.createdAt;
    const life = total > 0 ? Math.max(0, (effect.expiresAt - now) / total) : 0;
    // Bright flash-in then fade, not a linear fade — reads as a snap of energy.
    const flash = life > 0.75 ? 1 : life / 0.75;
    scene.coreMat.opacity = flash;
    scene.glowMat.opacity = flash * 0.55;
    scene.coreLine.visible = life > 0;
    scene.glowLine.visible = life > 0;
  });

  if (!basePoints) return null;

  return (
    <group>
      <primitive object={scene.glowLine} />
      <primitive object={scene.coreLine} />
    </group>
  );
}
