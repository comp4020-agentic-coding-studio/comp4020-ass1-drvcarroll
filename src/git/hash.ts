// Content addressing. Git names an object by a hash of what is inside it, and
// the explainer's two hardest ideas both rest on that: identical content is one
// object, and a commit whose parent changes gets a different name.

export type Rng = () => number; // [0, 1)

// Mulberry32: one 32-bit word of state, good enough to spread a digest and
// short enough to read. Not for anything that needs to resist an adversary.
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

export function intBelow(rng: Rng, n: number): number {
  return n <= 1 ? 0 : Math.floor(rng() * n);
}

export function pick<T>(rng: Rng, items: readonly T[]): T | undefined {
  return items[intBelow(rng, items.length)];
}

// FNV-1a over the payload, then mulberry32 to spread it. Real git uses SHA-1;
// this needs to be deterministic and short, not collision-resistant.
function digest(payload: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Seven hex characters, the abbreviation git itself shows.
export function oidFor(payload: string): string {
  const spread = mulberry32(digest(payload))();
  return Math.floor(spread * 0x10000000)
    .toString(16)
    .padStart(7, "0");
}

// An oid's hue, so "same content" is seen before it is read. Paired with the
// hex everywhere it is drawn: colour is never the only carrier.
export function hueFor(oid: string): number {
  return Math.round(mulberry32(digest(oid))() * 360);
}
