/** Deterministic string hash (djb2) — same spell id always seeds the same "random" pattern, so a card's look is stable across renders/reloads but still distinct per spell. */
export function seedFromString(str: string, salt = 0): number {
  let hash = 5381 + salt;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash >>> 0);
}

/** Tiny mulberry32 PRNG seeded from a number — deterministic sequence of [0,1) floats. */
export function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
