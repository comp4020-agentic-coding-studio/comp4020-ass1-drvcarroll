import { describe, expect, it } from "vitest";
import { NO_DEFENCES } from "../src/dns/attack.js";
import { resolve } from "../src/dns/resolve.js";
import {
  ROOT,
  SITE_NAMES,
  TLD,
  TLD_ORIGIN,
  authId,
  buildTopology,
  nsOf,
  resolverId,
  userId,
} from "../src/sim/topology.js";
import type { SimConfig } from "../src/sim/types.js";

// The level configs asserted their structure once, for one hand-written
// world. A generated world has to hold the same invariants for every shape
// the visitor can ask for, so these run across the count grid.

const base: SimConfig = {
  seed: 1,
  users: 1,
  resolvers: 1,
  authorities: 1,
  ratePerUser: 1,
  ttl: 300,
  mix: ["A"],
  attacker: "off",
  defences: NO_DEFENCES,
  capacity: {},
  offline: [],
};

const config = (patch: Partial<SimConfig>): SimConfig => ({ ...base, ...patch });

const GRID = [1, 3, 40].flatMap((users) =>
  [1, 3].flatMap((resolvers) =>
    [1, 5, 8].map((authorities) => ({ users, resolvers, authorities })),
  ),
);

describe("every world the visitor can build", () => {
  for (const counts of GRID) {
    const label = `${String(counts.users)}u ${String(counts.resolvers)}r ${String(counts.authorities)}a`;
    const t = buildTopology(config(counts));
    const edges = new Set(t.edges.map(([a, b]) => `${a}:${b}`));

    it(`${label}: gives every machine a node and one resolver`, () => {
      for (let i = 0; i < counts.users; i += 1) {
        const id = userId(i);
        expect(t.nodes[id]).toBeDefined();
        const resolver = t.resolverOf.get(id);
        expect(resolver).toBeDefined();
        expect(edges.has(`${id}:${resolver ?? ""}`)).toBe(true);
        // A stub asks one resolver. Two would make it a resolver itself.
        const mine = t.edges.filter(([from]) => from === id);
        expect(mine).toHaveLength(1);
      }
    });

    it(`${label}: lets every resolver reach every server`, () => {
      for (let i = 0; i < counts.resolvers; i += 1) {
        const id = resolverId(i);
        expect(t.nodes[id]).toBeDefined();
        expect(edges.has(`${id}:${ROOT}`)).toBe(true);
        expect(edges.has(`${id}:${TLD}`)).toBe(true);
        for (let a = 0; a < counts.authorities; a += 1) {
          expect(edges.has(`${id}:${authId(a)}`)).toBe(true);
        }
      }
    });

    it(`${label}: puts every node in exactly one tier`, () => {
      const flat = t.tiers.flat();
      expect(new Set(flat).size).toBe(flat.length);
      expect(new Set(flat)).toEqual(new Set(Object.keys(t.nodes)));
    });

    it(`${label}: spreads users evenly over the resolvers`, () => {
      const load = new Map<string, number>();
      for (const resolver of t.resolverOf.values()) {
        load.set(resolver, (load.get(resolver) ?? 0) + 1);
      }
      // Every resolver carries someone, and none carries two more than
      // another — otherwise growing a tier would skew what it measures.
      expect(load.size).toBe(Math.min(counts.resolvers, counts.users));
      const counted = [...load.values()];
      expect(Math.max(...counted) - Math.min(...counted)).toBeLessThanOrEqual(1);
    });

    it(`${label}: delegates every zone from its parent`, () => {
      const root = t.zones.find((z) => z.origin === ".");
      const tld = t.zones.find((z) => z.origin === TLD_ORIGIN);
      expect(root?.records.some((r) => r.type === "NS" && r.name === TLD_ORIGIN))
        .toBe(true);
      for (const [id, origin] of t.zoneOf) {
        const zone = t.zones.find((z) => z.server === id);
        expect(zone?.origin).toBe(origin);
        const ns = tld?.records.find(
          (r) => r.type === "NS" && r.name === origin,
        );
        expect(ns?.data).toBe(nsOf(origin));
        // Glue, or the referral names a server nobody can find.
        expect(
          tld?.records.some((r) => r.type === "A" && r.name === nsOf(origin)),
        ).toBe(true);
      }
    });
  }

  it("is deterministic: the same counts give the same wiring", () => {
    const a = buildTopology(config({ users: 17, resolvers: 4 }));
    const b = buildTopology(config({ users: 17, resolvers: 4 }));
    expect([...a.resolverOf]).toEqual([...b.resolverOf]);
    expect(a.edges).toEqual(b.edges);
  });

  it("grows rather than reshuffles: user 7 keeps its resolver", () => {
    const small = buildTopology(config({ users: 10, resolvers: 3 }));
    const large = buildTopology(config({ users: 40, resolvers: 3 }));
    expect(large.resolverOf.get(userId(7))).toBe(small.resolverOf.get(userId(7)));
  });
});

describe("the generated world answers questions", () => {
  const t = buildTopology(config({ authorities: 3 }));

  it("walks root, TLD and authority for a cold name", () => {
    const result = resolve({ name: "usyd.edu.au", type: "A" }, t.zones, {
      client: userId(0),
    });
    expect(result.outcome).toBe("answered");
    const visited = result.steps.map((s) => s.to);
    expect(visited).toContain(ROOT);
    expect(visited).toContain(TLD);
    expect(visited).toContain(authId(2));
  });

  it("restarts on the alias in the query pool", () => {
    const result = resolve({ name: "www.anu.edu.au", type: "A" }, t.zones, {});
    expect(result.outcome).toBe("answered");
    expect(result.steps.some((s) => s.kind === "cname")).toBe(true);
  });

  it("does not answer for a site outside the world's size", () => {
    // Growing the authorities tier is what brings a site into existence.
    const result = resolve({ name: "csiro.au", type: "A" }, t.zones, {});
    expect(result.outcome).toBe("nxdomain");
  });

  it("only offers names it can actually answer", () => {
    for (const name of t.names) {
      const result = resolve({ name, type: "A" }, t.zones, {});
      expect(result.outcome).toBe("answered");
    }
  });

  it("uses real registrations, so nothing here fails a lookup", () => {
    for (const origin of SITE_NAMES) {
      expect(origin.endsWith(".au.")).toBe(true);
      expect(origin).not.toMatch(/example|test|site\d/);
    }
  });

  it("carries the configured TTL on delegations, not just answers", () => {
    const world = buildTopology(config({ ttl: 42 }));
    for (const zone of world.zones) {
      for (const record of zone.records) {
        expect(record.ttl).toBe(42);
      }
    }
  });
});
