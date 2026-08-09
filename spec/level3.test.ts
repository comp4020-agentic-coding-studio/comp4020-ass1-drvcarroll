import { describe, expect, it } from "vitest";
import type { Cache } from "../src/dns/cache.js";
import { resolve } from "../src/dns/resolve.js";
import { LEVEL2, LEVEL2_ZONES } from "../src/levels/level2.js";
import { LEVEL3, LEVEL3_ZONES } from "../src/levels/level3.js";

// Level 3 adds a shared resolver and a second client. What it must not do is
// change the protocol — the walk is identical, only its starting point moves.

describe("level 3 extends level 2's world without rewriting it", () => {
  it("keeps every zone level 2 taught", () => {
    for (const zone of LEVEL2_ZONES) {
      const same = LEVEL3_ZONES.find((z) => z.origin === zone.origin);
      expect(same?.records).toEqual(expect.arrayContaining(zone.records));
    }
    expect(LEVEL2.zones).not.toBe(LEVEL3.zones);
  });

  it("adds a second delegation under the same TLD", () => {
    const au = LEVEL3_ZONES.find((z) => z.origin === "au.");
    const delegated = au?.records
      .filter((r) => r.type === "NS")
      .map((r) => r.name);
    expect(delegated).toContain("anu.edu.au.");
    expect(delegated).toContain("unsw.edu.au.");
  });

  it("declares a shared resolver and a simulated world", () => {
    expect(LEVEL3.clients).toHaveLength(2);
    expect(LEVEL3.caching).toBe(true);
    // Cache state is not observable from a browser, so live data would lie.
    expect(LEVEL3.simulated).toBe(true);
    expect(LEVEL2.caching).toBe(false);
    expect(LEVEL2.clients).toEqual(["stub"]);
  });

  it("gives every client a node and a way to reach the destinations", () => {
    const edges = new Set(LEVEL3.edges.map(([a, b]) => `${a}:${b}`));
    for (const client of LEVEL3.clients) {
      expect(LEVEL3.nodes[client]).toBeDefined();
      expect(edges.has(`${client}:recursor`)).toBe(true);
      for (const to of Object.values(LEVEL3.destinations)) {
        expect(edges.has(`${client}:${to}`)).toBe(true);
        // An address you do not have yet is not a line you can draw.
        expect(LEVEL3.deferredEdges.has(`${client}:${to}`)).toBe(true);
      }
    }
  });

  it("places every node in both layouts", () => {
    for (const id of Object.keys(LEVEL3.nodes)) {
      expect(LEVEL3.positions.wide[id]).toBeDefined();
      expect(LEVEL3.positions.narrow[id]).toBeDefined();
    }
  });
});

describe("the cache is the resolver's, not the client's", () => {
  it("serves the second machine from what the first one caused", () => {
    const cache: Cache = new Map();
    resolve({ name: "anu.edu.au", type: "A" }, LEVEL3_ZONES, {
      cache,
      client: "stub",
    });
    const other = resolve({ name: "anu.edu.au", type: "A" }, LEVEL3_ZONES, {
      cache,
      client: "stub2",
    });
    expect(other.outcome).toBe("answered");
    expect(other.steps[0]?.from).toBe("stub2");
    expect(other.steps.at(-1)?.to).toBe("stub2");
    // It never spoke to a nameserver at all.
    expect(other.steps.every((step) => step.to !== "root")).toBe(true);
  });
});
