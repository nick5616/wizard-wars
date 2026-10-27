/**
 * Equality for memoising entity-driven components (projectile/effect/domain/
 * barrier renderers). The 20Hz store sync (applyTick) hands every entity a
 * brand-new object each time even when nothing about it changed, so a plain
 * React.memo on the object reference never hits. This compares by value, one
 * level deep: primitives directly, small nested records (position/velocity/
 * direction {x,y,z}) field by field, and arrays element-wise by the same rule.
 */
function eq(a: unknown, b: unknown, depth: number): boolean {
  if (a === b) return true;
  if (depth === 0 || typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  if (ka.length !== Object.keys(b as object).length) return false;
  for (const k of ka) {
    if (!eq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth - 1)) return false;
  }
  return true;
}

export function entityEqual<K extends string>(key: K) {
  return (prev: Record<K, unknown>, next: Record<K, unknown>) => eq(prev[key], next[key], 2);
}
