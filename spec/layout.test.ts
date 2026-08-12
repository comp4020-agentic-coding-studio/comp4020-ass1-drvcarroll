import { describe, expect, it } from "vitest";
import { NO_DEFENCES } from "../src/dns/attack.js";
import type { LayoutName, Scene } from "../src/graph/layout.js";
import { layout } from "../src/graph/layout.js";
import { buildTopology } from "../src/sim/topology.js";
import type { SimConfig } from "../src/sim/types.js";
import { LIMITS } from "../src/sim/types.js";

// The two viewport claims — nothing clipped at 390px, nothing overlapping —
// used to be things you checked by looking. The visitor can now build the
// world, so they have to hold for every world rather than for one screenshot.

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

const scene = (patch: Partial<SimConfig>, name: LayoutName): Scene =>
  layout(buildTopology({ ...base, ...patch }), name);

const viewBox = (s: Scene): number[] => s.viewBox.split(" ").map(Number);

// A box is 60 tall and its own width; a dot is square. Both are centred.
const boxOf = (s: Scene, id: string) => {
  const p = s.positions[id];
  if (p === undefined) throw new Error(`unplaced: ${id}`);
  const w = s.widths[id] ?? 0;
  const h = s.shapes[id] === "dot" ? w : 60;
  return { left: p.x - w / 2, right: p.x + w / 2, top: p.y - h / 2, bottom: p.y + h / 2 };
};

const GRID = [1, 3, 40, LIMITS.users.max].flatMap((users) =>
  [1, LIMITS.resolvers.max].flatMap((resolvers) =>
    [1, LIMITS.authorities.max].map((authorities) => ({
      users,
      resolvers,
      authorities,
    })),
  ),
);

const LAYOUTS: LayoutName[] = ["wide", "narrow"];

describe("every world the visitor can build, at both viewports", () => {
  for (const counts of GRID) {
    for (const name of LAYOUTS) {
      const label = `${name} ${String(counts.users)}u ${String(counts.resolvers)}r ${String(counts.authorities)}a`;
      const topology = buildTopology({ ...base, ...counts });
      const s = layout(topology, name);

      it(`${label}: places every node`, () => {
        for (const id of Object.keys(topology.nodes)) {
          expect(s.positions[id]).toBeDefined();
          expect(s.shapes[id]).toBeDefined();
          expect(s.widths[id]).toBeGreaterThan(0);
        }
      });

      it(`${label}: draws nothing outside the viewBox`, () => {
        const [, , width = 0, height = 0] = viewBox(s);
        for (const id of Object.keys(topology.nodes)) {
          const b = boxOf(s, id);
          expect(b.left).toBeGreaterThanOrEqual(0);
          expect(b.right).toBeLessThanOrEqual(width);
          expect(b.top).toBeGreaterThanOrEqual(0);
          expect(b.bottom).toBeLessThanOrEqual(height);
        }
      });

      it(`${label}: never overlaps two nodes in one tier`, () => {
        for (const ids of topology.tiers) {
          for (let i = 0; i < ids.length; i += 1) {
            for (let j = i + 1; j < ids.length; j += 1) {
              const a = boxOf(s, ids[i] ?? "");
              const b = boxOf(s, ids[j] ?? "");
              const apart =
                a.right <= b.left ||
                b.right <= a.left ||
                a.bottom <= b.top ||
                b.bottom <= a.top;
              expect(apart).toBe(true);
            }
          }
        }
      });

      it(`${label}: keeps the tiers in order down the page`, () => {
        const lowest = topology.tiers.map((ids) =>
          Math.max(...ids.map((id) => boxOf(s, id).bottom)),
        );
        const highest = topology.tiers.map((ids) =>
          Math.min(...ids.map((id) => boxOf(s, id).top)),
        );
        for (let t = 1; t < topology.tiers.length; t += 1) {
          expect(highest[t] ?? 0).toBeGreaterThan(lowest[t - 1] ?? 0);
        }
      });
    }
  }
});

describe("growth changes the picture", () => {
  it("grows the viewBox when the users wrap to more rows", () => {
    const [, , , small = 0] = viewBox(scene({ users: 1 }, "narrow"));
    const [, , , large = 0] = viewBox(scene({ users: LIMITS.users.max }, "narrow"));
    expect(large).toBeGreaterThan(small);
  });

  it("wraps a full authority tier on the phone but not on the desktop", () => {
    const rowsOf = (s: Scene, ids: string[]): number =>
      new Set(ids.map((id) => s.positions[id]?.y)).size;
    const config = { authorities: LIMITS.authorities.max };
    const auths = buildTopology({ ...base, ...config }).tiers[2] ?? [];
    expect(rowsOf(scene(config, "narrow"), auths)).toBeGreaterThan(1);
    expect(rowsOf(scene(config, "wide"), auths)).toBe(1);
  });

  it("narrows the boxes as a tier fills rather than overflowing", () => {
    const one = scene({ authorities: 1 }, "wide");
    const many = scene({ authorities: LIMITS.authorities.max }, "wide");
    expect(many.widths.auth0 ?? 0).toBeLessThan(one.widths.auth0 ?? 0);
  });

  it("is deterministic: the same counts give the same coordinates", () => {
    const config = { users: 17, resolvers: 3, authorities: 5 };
    expect(scene(config, "wide").positions).toEqual(
      scene(config, "wide").positions,
    );
  });
});
