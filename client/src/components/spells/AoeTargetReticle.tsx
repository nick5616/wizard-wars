/**
 * Pre-cast ground preview for any equipped aoe spell: a circle (or, for
 * line-shaped spells like Fissure, a rectangle) showing where it will land
 * and how big it is, colored per spell, before you've even clicked. Snaps
 * under a player the crosshair is over, mirroring the server's own
 * ground-snap targeting (see SpellSystem._groundTargetPos) so the preview
 * matches where it actually lands, for every aimed aoe spell -- not just
 * Lightning Strike. Carries a few faint ambient sparks for that "something's
 * about to happen here" read.
 */

import { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../stores/gameStore';
import { getTargetObjects } from '../../networking/targetRegistry';
import { getSpell } from 'shared/spells';
import { buildJaggedSegment } from '../../utils/jaggedLine';

const AIM_DIST = 12;
const SPARK_COUNT = 4;

function resolvePlayerIdFromHit(obj: THREE.Object3D | null): string | undefined {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (cur.userData?.playerId) return cur.userData.playerId as string;
    cur = cur.parent;
  }
  return undefined;
}

export function AoeTargetReticle() {
  const { camera } = useThree();
  const raycasterRef = useRef(new THREE.Raycaster());
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const lastSparkRef = useRef(0);

  const local = useGameStore((s) => s.local);
  const players = useGameStore((s) => s.players);

  const spellId = local.equippedSpells[local.activeSlot];
  const onCooldown = (local.cooldowns[spellId ?? ''] ?? 0) > 0;
  const spell = spellId ? getSpell(spellId) : null;
  const isPreviewable = !!spell && spell.type === 'aoe' && !spell.isBarrier;
  const active = local.isAlive && isPreviewable && !onCooldown;

  const radius = spell?.radius ?? 2;
  const color = spell?.color ?? '#ffffff';
  const isLine = !!spell?.length;
  const lineLength = spell?.length ?? 0;
  const selfCentered = !!spell?.selfCast;

  const scene = useMemo(() => {
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const sparkLines: THREE.Line[] = [];
    const sparkGeos: THREE.BufferGeometry[] = [];
    const sparkMats: THREE.LineBasicMaterial[] = [];
    for (let i = 0; i < SPARK_COUNT; i++) {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
      sparkGeos.push(geo);
      sparkMats.push(mat);
      sparkLines.push(new THREE.Line(geo, mat));
    }
    return { ringMat, sparkLines, sparkGeos, sparkMats };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);

  useEffect(() => () => {
    scene.ringMat.dispose();
    for (const g of scene.sparkGeos) g.dispose();
    for (const m of scene.sparkMats) m.dispose();
  }, [scene]);

  useFrame(() => {
    if (!groupRef.current) return;
    if (!active) {
      groupRef.current.visible = false;
      return;
    }

    let cx: number, cz: number, ry = 0;

    if (selfCentered) {
      cx = local.position.x;
      cz = local.position.z;
    } else {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const origin = new THREE.Vector3(local.position.x, local.position.y, local.position.z);

      if (isLine) {
        cx = origin.x;
        cz = origin.z;
        ry = Math.atan2(fwd.x, fwd.z);
      } else {
        raycasterRef.current.set(origin, fwd);
        raycasterRef.current.far = AIM_DIST;
        const hits = raycasterRef.current.intersectObjects(getTargetObjects(), true);
        const hitId = hits.length > 0 ? resolvePlayerIdFromHit(hits[0].object) : undefined;
        const hitPlayer = hitId ? players[hitId] : null;
        if (hitPlayer) {
          cx = hitPlayer.position.x;
          cz = hitPlayer.position.z;
        } else {
          cx = origin.x + fwd.x * AIM_DIST;
          cz = origin.z + fwd.z * AIM_DIST;
        }
      }
    }

    groupRef.current.visible = true;
    groupRef.current.position.set(cx, 0.05, cz);
    groupRef.current.rotation.set(0, ry, 0);

    if (ringRef.current) {
      const pulse = 0.9 + Math.sin(Date.now() / 220) * 0.1;
      ringRef.current.scale.setScalar(pulse);
    }

    const now = Date.now();
    if (now - lastSparkRef.current > 160) {
      lastSparkRef.current = now;
      for (let i = 0; i < SPARK_COUNT; i++) {
        if (Math.random() > 0.55) { scene.sparkMats[i].opacity = 0; continue; }
        const angle = Math.random() * Math.PI * 2;
        const ringR = radius * (0.6 + Math.random() * 0.5);
        const a = new THREE.Vector3(Math.cos(angle) * ringR, 0, Math.sin(angle) * ringR);
        const inward = Math.random() * radius * 0.3;
        const b = new THREE.Vector3(Math.cos(angle) * (ringR - inward), 0.3 + Math.random() * 0.4, Math.sin(angle) * (ringR - inward));
        const positions = new Float32Array(buildJaggedSegment(a, b, 2, 0.2));
        scene.sparkGeos[i].setAttribute('position', new THREE.BufferAttribute(positions, 3));
        scene.sparkGeos[i].attributes.position.needsUpdate = true;
        scene.sparkMats[i].opacity = 0.25 + Math.random() * 0.25;
      }
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} material={scene.ringMat} position={isLine ? [0, 0, lineLength / 2] : [0, 0, 0]}>
        {isLine
          ? <planeGeometry args={[radius * 2, lineLength]} />
          : <ringGeometry args={[Math.max(0.05, radius - 0.15), radius, 40]} />}
      </mesh>
      {!isLine && scene.sparkLines.map((line, i) => <primitive key={i} object={line} />)}
    </group>
  );
}
