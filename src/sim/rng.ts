// Every random draw in the simulation comes from here, seeded, so a run is
// reproducible and the tests can assert what a configuration actually does.
// Math.random() anywhere under src/sim/ would leave those tests passing while
// making them worthless.

export type Rng = () => number; // [0, 1)

// Mulberry32: one 32-bit word of state, good enough for arrival jitter and
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

// Exponential inter-arrival times, so queries arrive as a Poisson process and
// the count over an interval never depends on how finely we sample it.
export function expDelay(rng: Rng, ratePerSec: number): number {
  if (ratePerSec <= 0) return Infinity;
  // 1 - rng() keeps the log argument off zero, so the delay stays finite.
  return -Math.log(1 - rng()) / ratePerSec;
}
