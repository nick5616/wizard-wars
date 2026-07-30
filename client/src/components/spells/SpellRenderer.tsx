/**
 * Master renderer — maps authoritative server state to visual spell effects.
 */

import { useGameStore } from '../../stores/gameStore';
import { ProjectileSpell } from './ProjectileSpell';
import { HitscanFlash } from './HitscanFlash';
import { BeamSpell } from './BeamSpell';
import { DomainExpansion } from './DomainExpansion';
import { MeleeSwing } from './MeleeSwing';

export function SpellRenderer() {
  const projectiles = useGameStore((s) => s.projectiles);
  const effects = useGameStore((s) => s.effects);
  const domains = useGameStore((s) => s.domains);

  const now = Date.now();

  return (
    <>
      {/* Projectiles */}
      {Object.values(projectiles).map((proj) =>
        proj.active && now < proj.expiresAt ? (
          <ProjectileSpell key={proj.id} projectile={proj} />
        ) : null
      )}

      {/* Hitscan flashes and beams */}
      {Object.values(effects).map((effect) => {
        if (!effect.active || now > effect.expiresAt) return null;
        if (effect.type === 'hitscan_flash') {
          return <HitscanFlash key={effect.id} effect={effect} />;
        }
        if (effect.type === 'beam') {
          return <BeamSpell key={effect.id} effect={effect} />;
        }
        if (effect.type === 'melee_swing') {
          return <MeleeSwing key={effect.id} effect={effect} />;
        }
        return null;
      })}

      {/* Domain expansions */}
      {Object.values(domains).map((domain) =>
        domain.active && now < domain.expiresAt ? (
          <DomainExpansion key={domain.id} domain={domain} />
        ) : null
      )}
    </>
  );
}
