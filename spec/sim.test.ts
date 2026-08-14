import { describe, expect, it } from "vitest";
import { NO_DEFENCES } from "../src/dns/attack.js";
import {
  createSim,
  hitRate,
  percentile,
  previewQuery,
  reconfigure,
  stepTo,
  type SimState,
} from "../src/sim/engine.js";
import { ROOT, TLD, authId, resolverId, userId } from "../src/sim/topology.js";
import type { SimConfig } from "../src/sim/types.js";

// The page's argument, executable. Everything asserted here is something the
// visitor is invited to discover by moving a knob, so if one of these stops
// holding, the page is teaching something false rather than merely looking odd.

const base: SimConfig = {
  seed: 1,
  users: 4,
  resolvers: 1,
  authorities: 8,
  ratePerUser: 1,
  ttl: 300,
  mix: ["A"],
  attacker: "off",
  defences: NO_DEFENCES,
  capacity: {},
  offline: [],
};

const sim = (patch: Partial<SimConfig> = {}): SimState =>
  createSim({ ...base, ...patch });

const queriesAt = (state: SimState, id: string): number =>
  state.nodes.get(id)?.queries ?? 0;

describe("the clock", () => {
  it("does not care how finely it is sampled", () => {
    const once = sim();
    stepTo(once, 300);

    const often = sim();
    for (let i = 0; i < 3000; i += 1) stepTo(often, (i + 1) * 0.1);

    expect(often.totals).toEqual(once.totals);
    expect(queriesAt(often, ROOT)).toBe(queriesAt(once, ROOT));
    expect(percentile(often, 0.95)).toBe(percentile(once, 0.95));
  });

  it("gives the same run twice for one seed, and a different one otherwise", () => {
    const a = sim();
    const b = sim();
    const other = sim({ seed: 2 });
    stepTo(a, 200);
    stepTo(b, 200);
    stepTo(other, 200);
    expect(a.totals).toEqual(b.totals);
    expect(other.totals).not.toEqual(a.totals);
  });

  it("produces queries at roughly the rate asked for", () => {
    const state = sim({ users: 10, ratePerUser: 2 });
    stepTo(state, 100);
    // 10 users x 2/s x 100s = 2000, give or take the arrivals' own variance.
    expect(state.totals.queries).toBeGreaterThan(1800);
    expect(state.totals.queries).toBeLessThan(2200);
  });
});

describe("caching is what keeps the hierarchy standing", () => {
  const long = sim({ ttl: 3600 });
  const short = sim({ ttl: 1 });
  stepTo(long, 600);
  stepTo(short, 600);

  it("answers most queries from memory when records live a while", () => {
    expect(hitRate(long)).toBeGreaterThan(0.85);
  });

  it("stops doing so when they do not", () => {
    expect(hitRate(short)).toBeLessThan(0.25);
  });

  it("keeps the same load off the root and the registry entirely", () => {
    // The claim the page is built on: the apex survives on being asked
    // rarely, not on being large.
    expect(queriesAt(short, ROOT)).toBeGreaterThan(queriesAt(long, ROOT) * 10);
    expect(queriesAt(short, TLD)).toBeGreaterThan(queriesAt(long, TLD) * 10);
  });

  it("leaves the same number of queries asked either way", () => {
    // Only the work behind them changed, which is the point.
    expect(short.totals.queries).toBe(long.totals.queries);
  });
});

describe("a server going down", () => {
  it("is survivable for a while under a long TTL, then is not", () => {
    const state = sim({ ttl: 600, users: 8 });
    stepTo(state, 600);

    const before = state.totals.failed;
    reconfigure(state, {
      ...state.config,
      offline: [authId(0), authId(1), authId(2), authId(3)],
    });
    // reconfigure does not flush unless the TTL moved, so the memory of
    // those servers outlives the servers themselves.
    stepTo(state, 660);
    const soon = state.totals.failed - before;

    stepTo(state, 1400);
    const later = state.totals.failed - before - soon;
    expect(later).toBeGreaterThan(soon);
  });

  it("reports a timeout rather than a missing name", () => {
    const state = sim({ ttl: 5, offline: [ROOT] });
    stepTo(state, 60);
    expect(state.totals.failed).toBeGreaterThan(0);
    expect(state.totals.answered).toBe(0);
  });
});

describe("a server past its capacity", () => {
  it("drops queries and slows the ones it keeps", () => {
    const easy = sim({ ttl: 1, users: 20, ratePerUser: 2 });
    // The registry, not the root: caching keeps the apex quiet, so the
    // ceiling that actually bites is one tier down.
    const starved = sim({
      ttl: 1,
      users: 20,
      ratePerUser: 2,
      capacity: { [TLD]: 1 },
    });
    stepTo(easy, 300);
    stepTo(starved, 300);

    expect(easy.totals.dropped).toBe(0);
    expect(starved.totals.dropped).toBeGreaterThan(0);
    expect(percentile(starved, 0.95)).toBeGreaterThan(percentile(easy, 0.95));
  });

  it("leaves a server with headroom alone", () => {
    const state = sim({ users: 2, ratePerUser: 1, capacity: { [TLD]: 50 } });
    stepTo(state, 200);
    expect(state.totals.dropped).toBe(0);
  });
});

describe("one lie, and how far it travels", () => {
  it("spreads to everyone sharing the poisoned resolver", () => {
    const state = sim({ users: 20, resolvers: 1, attacker: "onpath", ttl: 60 });
    stepTo(state, 300);
    // Not one victim: the cache is shared infrastructure, so the forgery is
    // served over and over without the attacker sending another packet.
    expect(state.totals.lied).toBeGreaterThan(1);
    expect(state.totals.lied).toBeLessThanOrEqual(state.totals.queries);
  });

  it("serves far more lies than the attacker sent forgeries", () => {
    const state = sim({ users: 20, resolvers: 1, attacker: "onpath", ttl: 600 });
    stepTo(state, 600);
    // The gap between these two numbers is the argument: the attacker gets
    // one reply believed, and the cache does the rest of the work for it.
    expect(state.totals.forged).toBeGreaterThan(0);
    expect(state.totals.lied).toBeGreaterThan(state.totals.forged * 5);
  });

  it("never lands at all once the records are signed", () => {
    const state = sim({
      users: 20,
      attacker: "onpath",
      ttl: 60,
      defences: { ports: false, dnssec: true },
    });
    stepTo(state, 300);
    expect(state.totals.lied).toBe(0);
  });

  it("is much harder off-path than on it", () => {
    const near = sim({ users: 20, attacker: "onpath", ttl: 60 });
    const far = sim({ users: 20, attacker: "offpath", ttl: 60 });
    stepTo(near, 300);
    stepTo(far, 300);
    expect(far.totals.lied).toBeLessThan(near.totals.lied);
  });
});

describe("growing the world mid-run", () => {
  it("keeps the counters and adds the machines", () => {
    const state = sim({ users: 2 });
    stepTo(state, 120);
    const before = state.totals.queries;

    reconfigure(state, { ...state.config, users: 30, resolvers: 3 });
    expect(state.totals.queries).toBe(before);
    stepTo(state, 240);

    expect(state.totals.queries).toBeGreaterThan(before);
    expect(queriesAt(state, userId(29))).toBeGreaterThan(0);
    expect(state.caches.has(resolverId(2))).toBe(true);
  });

  it("forgets the machines it removed", () => {
    const state = sim({ users: 30, resolvers: 3 });
    stepTo(state, 120);
    reconfigure(state, { ...state.config, users: 2, resolvers: 1 });
    expect(state.nodes.has(userId(29))).toBe(false);
    expect(state.caches.has(resolverId(2))).toBe(false);
    expect(state.pending.every((a) => a.user === userId(0) || a.user === userId(1)))
      .toBe(true);
  });

  it("flushes the caches when the TTL moves, and only then", () => {
    const state = sim({ ttl: 300 });
    stepTo(state, 120);
    expect(state.caches.get(resolverId(0))?.size).toBeGreaterThan(0);

    reconfigure(state, { ...state.config, users: 5 });
    expect(state.caches.get(resolverId(0))?.size).toBeGreaterThan(0);

    reconfigure(state, { ...state.config, ttl: 30 });
    expect(state.caches.get(resolverId(0))?.size).toBe(0);
  });

  it("lowers the rate rather than the crowd when the budget is hit", () => {
    const state = sim({ users: 60, ratePerUser: 20 });
    expect(state.config.users).toBe(60);
    expect(state.config.ratePerUser).toBeLessThan(20);
  });
});

// Following a query must not be a way of asking one. The transcript is drawn
// from a copy of the cache and its own draws, so watching costs the world
// nothing — otherwise every drill-down would quietly inflate the readouts.
describe("watching one query", () => {
  it("leaves the counters and the cache exactly as they were", () => {
    const state = sim();
    stepTo(state, 60);
    const cache = state.caches.get(resolverId(0));
    const before = { ...state.totals };
    const held = new Map(cache);

    const result = previewQuery(state, userId(0));
    expect(result?.steps.length).toBeGreaterThan(0);
    expect(state.totals).toEqual(before);
    expect([...(cache ?? [])]).toEqual([...held]);
  });

  it("does not move the arrival sequence the world is running on", () => {
    const a = sim();
    const b = sim();
    stepTo(a, 60);
    stepTo(b, 60);
    previewQuery(b, userId(0));
    stepTo(a, 120);
    stepTo(b, 120);
    expect(b.totals).toEqual(a.totals);
  });

  it("has nothing to follow for a machine that is not on the network", () => {
    expect(previewQuery(sim(), "root")).toBeUndefined();
  });
});
