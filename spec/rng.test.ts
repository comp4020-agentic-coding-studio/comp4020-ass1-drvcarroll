import { describe, expect, it } from "vitest";
import { expDelay, intBelow, mulberry32, pick } from "../src/sim/rng.js";

// The simulation's claims are only worth as much as its reproducibility. If
// the generator drifts, every assertion in sim.test.ts still passes while
// measuring a different world — so the sequence itself is pinned here.

describe("the seeded generator", () => {
  it("produces a fixed sequence for a given seed", () => {
    const rng = mulberry32(1);
    const drawn = Array.from({ length: 5 }, () => Number(rng().toFixed(10)));
    expect(drawn).toEqual([
      0.6270739406, 0.0027357212, 0.52744704, 0.9810509675, 0.9683778982,
    ]);
  });

  it("gives two generators on one seed the same stream", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const pairs = Array.from({ length: 50 }, () => a() === b());
    expect(pairs.every(Boolean)).toBe(true);
  });

  it("stays inside [0, 1)", () => {
    const rng = mulberry32(3);
    let low = 1;
    let high = 0;
    for (let i = 0; i < 20000; i += 1) {
      const value = rng();
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThan(1);
  });

  it("keeps intBelow inside the bound, and degenerate cases at zero", () => {
    const rng = mulberry32(11);
    const drawn = Array.from({ length: 500 }, () => intBelow(rng, 6));
    expect(Math.min(...drawn)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...drawn)).toBeLessThan(6);
    expect(intBelow(rng, 1)).toBe(0);
    expect(intBelow(rng, 0)).toBe(0);
  });

  it("picks from a list, and reports an empty one honestly", () => {
    const rng = mulberry32(13);
    const items = ["a", "b", "c"] as const;
    const drawn = Array.from({ length: 200 }, () => pick(rng, items));
    expect(new Set(drawn)).toEqual(new Set(items));
    expect(pick(rng, [])).toBeUndefined();
  });
});

describe("arrival timing", () => {
  // A Poisson process is what makes the query count over an interval
  // independent of how finely the loop samples it.
  it("draws delays averaging one over the rate", () => {
    const rng = mulberry32(2);
    const runs = 200000;
    let total = 0;
    for (let i = 0; i < runs; i += 1) total += expDelay(rng, 4);
    expect(total / runs).toBeCloseTo(0.25, 2);
  });

  it("never returns zero, so a user cannot arrive twice at one instant", () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 5000; i += 1) {
      expect(expDelay(rng, 20)).toBeGreaterThan(0);
    }
  });

  it("puts a silent user infinitely far in the future", () => {
    const rng = mulberry32(9);
    expect(expDelay(rng, 0)).toBe(Infinity);
    expect(expDelay(rng, -1)).toBe(Infinity);
  });
});
