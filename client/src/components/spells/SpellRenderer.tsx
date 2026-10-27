/**
 * Master renderer — maps authoritative server state to visual spell effects.
 */

import { useGameStore } from '../../stores/gameStore';
import { ProjectileSpell } from './ProjectileSpell';
import { HitscanFlash } from './HitscanFlash';
import { BeamSpell } from './BeamSpell';
import { DomainExpansion } from './DomainExpansion';
import { MeleeSwing } from './MeleeSwing';
import { BarrierRenderer } from './BarrierRenderer';
import { AoeSpell } from './AoeSpell';
import { AmaterasuSpell } from './AmaterasuSpell';
import { LightningStrikeSpell } from './LightningStrikeSpell';
import { ChainLightningArc } from './ChainLightningArc';
import { RuneSpell } from './RuneSpell';
import { GemPlopSpell } from './GemPlopSpell';
import { AirbudSpell } from './AirbudSpell';
import { Suspense, memo } from 'react';
import { entityEqual } from '../../utils/propsEqual';

// applyTick replaces every entity object on each 20Hz sync, so without value
// equality all spell components re-rendered (and re-diffed their meshes) every
// sync even when the effect hadn't changed. Static effects now skip it.
const Projectile = memo(ProjectileSpell, entityEqual('projectile'));
const Hitscan = memo(HitscanFlash, entityEqual('effect'));
const Beam = memo(BeamSpell, entityEqual('effect'));
const Melee = memo(MeleeSwing, entityEqual('effect'));
const Aoe = memo(AoeSpell, entityEqual('effect'));
const Lightning = memo(LightningStrikeSpell, entityEqual('effect'));
const Amaterasu = memo(AmaterasuSpell, entityEqual('effect'));
const Chain = memo(ChainLightningArc, entityEqual('effect'));
const Rune = memo(RuneSpell, entityEqual('effect'));
const Airbud = memo(AirbudSpell, entityEqual('effect'));
const GemPlop = memo(GemPlopSpell, entityEqual('effect'));
const Domain = memo(DomainExpansion, entityEqual('domain'));
const Barrier = memo(BarrierRenderer, entityEqual('barrier'));

export function SpellRenderer() {
  const projectiles = useGameStore((s) => s.projectiles);
  const effects = useGameStore((s) => s.effects);
  const domains = useGameStore((s) => s.domains);
  const barriers = useGameStore((s) => s.barriers);

  const now = Date.now();

  return (
    <>
      {/* Projectiles */}
      {Object.values(projectiles).map((proj) =>
        proj.active && now < proj.expiresAt ? (
          <Projectile key={proj.id} projectile={proj} />
        ) : null
      )}

      {/* Hitscan flashes and beams */}
      {Object.values(effects).map((effect) => {
        if (!effect.active || now > effect.expiresAt) return null;
        if (effect.type === 'hitscan_flash') {
          return <Hitscan key={effect.id} effect={effect} />;
        }
        if (effect.type === 'beam') {
          return <Beam key={effect.id} effect={effect} />;
        }
        if (effect.type === 'melee_swing') {
          return <Melee key={effect.id} effect={effect} />;
        }
        if (effect.type === 'aoe') {
          return effect.spellId === 'lightning_strike'
            ? <Lightning key={effect.id} effect={effect} />
            : <Aoe key={effect.id} effect={effect} />;
        }
        if (effect.type === 'amaterasu') {
          return <Amaterasu key={effect.id} effect={effect} />;
        }
        if (effect.type === 'chain_lightning') {
          return <Chain key={effect.id} effect={effect} />;
        }
        if (effect.type === 'rune') {
          return <Rune key={effect.id} effect={effect} />;
        }
        if (effect.type === 'airbud') {
          return (
            <Suspense key={effect.id} fallback={null}>
              <Airbud effect={effect} />
            </Suspense>
          );
        }
        if (effect.type === 'gem_decoy') {
          return <GemPlop key={effect.id} effect={effect} />;
        }
        return null;
      })}

      {/* Domain expansions */}
      {Object.values(domains).map((domain) =>
        domain.active && now < domain.expiresAt ? (
          <Domain key={domain.id} domain={domain} />
        ) : null
      )}

      {/* Barriers (Ice Wall, Rock Wall) */}
      {Object.values(barriers).map((barrier) =>
        barrier.active ? <Barrier key={barrier.id} barrier={barrier} /> : null
      )}
    </>
  );
}
