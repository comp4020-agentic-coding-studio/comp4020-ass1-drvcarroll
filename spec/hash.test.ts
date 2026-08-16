import { describe, expect, it } from "vitest";
import { hueFor, intBelow, mulberry32, oidFor, pick } from "../src/git/hash.js";

// Content addressing is load-bearing: the explainer argues that identical
// content is one object and that a rebased commit is a different object. Both
// are claims about this file, so they are pinned here rather than asserted by
// a caption on the page.

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

describe("object ids", () => {
  it("names identical content identically", () => {
    expect(oidFor("hello")).toBe(oidFor("hello"));
  });

  it("names different content differently", () => {
    expect(oidFor("hello")).not.toBe(oidFor("hello "));
  });

  it("is seven hex characters, the abbreviation git shows", () => {
    for (const text of ["", "a", "a much longer line of file content"]) {
      expect(oidFor(text)).toMatch(/^[0-9a-f]{7}$/);
    }
  });

  // Collisions would make "same content, same object" a lie on screen. Not a
  // cryptographic claim, just enough headroom for a page-sized repository.
  it("keeps a few thousand distinct payloads distinct", () => {
    const seen = new Set(
      Array.from({ length: 4000 }, (_, i) => oidFor(`line ${String(i)}`)),
    );
    expect(seen.size).toBe(4000);
  });
});

describe("the colour an oid carries", () => {
  it("gives one oid one hue, so sameness is seen before it is read", () => {
    expect(hueFor("a3f91c2")).toBe(hueFor("a3f91c2"));
  });

  it("is a hue", () => {
    for (const oid of ["a3f91c2", "0000000", "fffffff"]) {
      const hue = hueFor(oid);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThanOrEqual(360);
    }
  });
});
