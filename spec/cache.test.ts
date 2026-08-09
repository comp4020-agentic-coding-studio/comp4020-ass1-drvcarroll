import { describe, expect, it } from "vitest";
import { answerFor, entries, remember, startZone } from "../src/dns/cache.js";
import type { Cache } from "../src/dns/cache.js";
import { resolve } from "../src/dns/resolve.js";
import { LEVEL3_ZONES } from "../src/levels/level3.js";
import type { ResolutionStep } from "../src/dns/types.js";

// Caching is the level's subject, and the claim being tested is a specific
// one: it is the *referral* being remembered, not just the answer, which is
// what lets a later walk start partway down the tree.

const asked = (steps: ResolutionStep[], node: string): boolean =>
  steps.some((step) => step.to === node && step.from !== step.to);

const sent = (steps: ResolutionStep[]): number =>
  steps.filter((step) => step.from !== step.to).length;

const warm = (name: string, cache: Cache, now = 0): ResolutionStep[] =>
  resolve({ name, type: "A" }, LEVEL3_ZONES, { cache, now }).steps;

describe("the cache stores a delegation under the child it delegates to", () => {
  it("keys a referral by the zone it hands you, not the parent", () => {
    const cache: Cache = new Map();
    remember(
      cache,
      { name: "www.anu.edu.au.", type: "A" },
      {
        kind: "referral",
        records: [
          { name: "au.", type: "NS", ttl: 100, data: "ns1.au." },
          { name: "ns1.au.", type: "A", ttl: 100, data: "203.119.40.1" },
        ],
      },
      0,
    );
    expect(cache.has("au.|NS")).toBe(true);
    expect(cache.has("www.anu.edu.au.|A")).toBe(false);
  });

  it("offers a cached delegation to every name inside that zone", () => {
    const cache: Cache = new Map();
    warm("www.anu.edu.au", cache);
    expect(startZone(cache, "mail.anu.edu.au.", 0)).toBe("anu.edu.au.");
    // A sibling zone under the same TLD only gets the TLD's delegation.
    expect(startZone(cache, "www.unsw.edu.au.", 0)).toBe("au.");
    expect(startZone(cache, "www.google.com.", 0)).toBe(".");
  });

  it("expires an entry the moment its TTL runs out", () => {
    const cache: Cache = new Map();
    warm("www.anu.edu.au", cache);
    const answer = answerFor(cache, { name: "www.anu.edu.au.", type: "A" }, 0);
    expect(answer?.expires).toBe(3600);
    expect(answerFor(cache, { name: "www.anu.edu.au.", type: "A" }, 3600))
      .toBeUndefined();
    // The delegation above it lives far longer, so the walk still starts deep.
    expect(startZone(cache, "www.anu.edu.au.", 3600)).toBe("anu.edu.au.");
    expect(entries(cache, 3600).length).toBeLessThan(entries(cache, 0).length);
  });
});

describe("a warm resolver sends fewer messages", () => {
  it("sends nothing upstream for a name it already holds", () => {
    const cache: Cache = new Map();
    const cold = warm("www.anu.edu.au", cache);
    const second = warm("www.anu.edu.au", cache);
    expect(sent(second)).toBe(2); // the client's question and its answer
    expect(sent(second)).toBeLessThan(sent(cold));
    expect(second.some((step) => step.kind === "cached")).toBe(true);
  });

  it("skips the root and the TLD for a new name in a known zone", () => {
    const cache: Cache = new Map();
    warm("www.anu.edu.au", cache);
    const steps = warm("mail.anu.edu.au", cache);
    expect(asked(steps, "root")).toBe(false);
    expect(asked(steps, "tld")).toBe(false);
    expect(asked(steps, "auth")).toBe(true);
  });

  it("skips only the root for a sibling zone under the same TLD", () => {
    const cache: Cache = new Map();
    warm("www.anu.edu.au", cache);
    const steps = warm("www.unsw.edu.au", cache);
    expect(asked(steps, "root")).toBe(false);
    expect(asked(steps, "tld")).toBe(true);
  });

  it("walks from the root again once the delegation has expired", () => {
    const cache: Cache = new Map();
    warm("www.anu.edu.au", cache);
    const later = warm("www.anu.edu.au", cache, 172800);
    expect(asked(later, "root")).toBe(true);
  });

  it("leaves an uncached resolver exactly as level 1 had it", () => {
    const bare = resolve({ name: "www.anu.edu.au", type: "A" }, LEVEL3_ZONES);
    expect(bare.steps.some((step) => step.kind === "cached")).toBe(false);
    expect(asked(bare.steps, "root")).toBe(true);
  });
});
