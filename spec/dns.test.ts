import { describe, expect, it } from "vitest";
import { RECURSOR, STUB, resolve, respond } from "../src/dns/resolve.js";
import { ZONES } from "../src/levels/level1.js";
import type { Zone } from "../src/dns/types.js";

// Protocol tests. These run headless because src/dns never touches the DOM —
// if that stops being true, these tests are the first thing to break.

const zoneOf = (origin: string): Zone => {
  const zone = ZONES.find((z) => z.origin === origin);
  if (zone === undefined) throw new Error(`no zone named ${origin}`);
  return zone;
};

const QUERY = { name: "www.anu.edu.au.", type: "A" } as const;

describe("a nameserver answers, refers, or denies — never looks things up", () => {
  it("refers to the TLD when asked about a name it does not serve", () => {
    const response = respond(zoneOf("."), QUERY);
    expect(response.kind).toBe("referral");
    expect(response.records.some((r) => r.type === "NS")).toBe(true);
  });

  it("ships glue with the referral so the nameserver is reachable", () => {
    const response = respond(zoneOf("au."), QUERY);
    const ns = response.records.find((r) => r.type === "NS");
    expect(ns).toBeDefined();
    expect(response.records.some((r) => r.type === "A" && r.name === ns?.data))
      .toBe(true);
  });

  it("answers only from the zone that is authoritative for the name", () => {
    expect(respond(zoneOf("anu.edu.au."), QUERY).kind).toBe("answer");
  });

  it("matches delegations on label boundaries, not raw suffixes", () => {
    // "fooau." is not inside "au." — only a whole-label match counts, or the
    // root would hand "fooau." to the Australian nameservers.
    const response = respond(zoneOf("."), { name: "fooau.", type: "A" });
    expect(response.kind).toBe("nxdomain");
  });

  it("denies a name that exists nowhere in the tree", () => {
    const response = respond(zoneOf("anu.edu.au."), {
      name: "nope.anu.edu.au.",
      type: "A",
    });
    expect(response.kind).toBe("nxdomain");
  });
});

describe("the recursor walks the tree, the client does not", () => {
  const result = resolve(QUERY, ZONES);

  it("resolves to the authoritative address", () => {
    expect(result.outcome).toBe("answered");
    expect(result.answer[0]?.data).toBe("149.171.96.10");
  });

  it("asks the client exactly one question and gives it one answer", () => {
    const clientSteps = result.steps.filter(
      (s) => s.from === STUB || s.to === STUB,
    );
    expect(clientSteps).toHaveLength(2);
    expect(clientSteps[0]?.to).toBe(RECURSOR);
    expect(clientSteps[1]?.from).toBe(RECURSOR);
  });

  it("visits root, then TLD, then the authoritative server, in that order", () => {
    const asked = result.steps
      .filter((s) => s.kind === "query" && s.from === RECURSOR)
      .map((s) => s.to);
    expect(asked).toEqual(["root", "tld", "auth"]);
  });

  it("collects two referrals and exactly one authoritative answer", () => {
    const fromServers = result.steps.filter((s) => s.to === RECURSOR);
    expect(fromServers.filter((s) => s.kind === "referral")).toHaveLength(2);
    expect(fromServers.filter((s) => s.kind === "answer")).toHaveLength(1);
  });

  it("returns NXDOMAIN for a name the tree does not hold", () => {
    const missing = resolve({ name: "nope.anu.edu.au.", type: "A" }, ZONES);
    expect(missing.outcome).toBe("nxdomain");
  });

  it("resolves a name under a different TLD", () => {
    const result = resolve({ name: "www.google.com", type: "A" }, ZONES);
    expect(result.outcome).toBe("answered");
    expect(result.answer[0]?.data).toBe("142.250.70.196");
  });

  it("reuses the one TLD seat for whichever zone is being asked", () => {
    const au = resolve({ name: "www.anu.edu.au", type: "A" }, ZONES);
    const com = resolve({ name: "www.google.com", type: "A" }, ZONES);
    const zoneAtTld = (r: typeof au) =>
      r.steps.find((s) => s.to === "tld")?.zone;

    expect(zoneAtTld(au)).toBe("au.");
    expect(zoneAtTld(com)).toBe("com.");
  });

  it("accepts a name without its trailing root dot", () => {
    expect(resolve({ name: "www.anu.edu.au", type: "A" }, ZONES).outcome).toBe(
      "answered",
    );
  });
});

// A small world of its own: level 1's zones are deliberately alias-free, so
// the CNAME behaviour is pinned here rather than by changing what L1 teaches.
const ALIAS_ZONES: Zone[] = [
  {
    origin: ".",
    server: "root",
    records: [
      { name: "example.", type: "NS", ttl: 172800, data: "ns.example." },
      { name: "ns.example.", type: "A", ttl: 172800, data: "192.0.2.1" },
      { name: ".", type: "SOA", ttl: 86400, data: "a.root-servers.net." },
    ],
  },
  {
    origin: "example.",
    server: "auth",
    records: [
      { name: "www.example.", type: "CNAME", ttl: 300, data: "host.example." },
      { name: "host.example.", type: "A", ttl: 300, data: "192.0.2.9" },
      { name: "a.example.", type: "CNAME", ttl: 300, data: "b.example." },
      { name: "b.example.", type: "CNAME", ttl: 300, data: "a.example." },
      { name: "example.", type: "SOA", ttl: 3600, data: "ns.example." },
    ],
  },
];

describe("a CNAME is an alias, so resolution starts over", () => {
  const aliased = resolve({ name: "www.example.", type: "A" }, ALIAS_ZONES);

  it("hands back the alias rather than the address that was asked for", () => {
    const cname = aliased.steps.find((s) => s.kind === "cname");
    expect(cname?.records[0]?.data).toBe("host.example.");
  });

  it("walks the tree a second time, from the root, for the alias", () => {
    const toRoot = aliased.steps.filter(
      (s) => s.kind === "query" && s.to === "root",
    );
    expect(toRoot).toHaveLength(2);
  });

  it("ends on the address the alias points at", () => {
    expect(aliased.outcome).toBe("answered");
    expect(aliased.answer[0]?.data).toBe("192.0.2.9");
  });

  it("answers a CNAME directly when that is what was asked for", () => {
    const asked = resolve({ name: "www.example.", type: "CNAME" }, ALIAS_ZONES);
    expect(asked.steps.some((s) => s.kind === "cname")).toBe(false);
    expect(asked.outcome).toBe("answered");
  });

  it("stops instead of looping when two aliases point at each other", () => {
    const looped = resolve({ name: "a.example.", type: "A" }, ALIAS_ZONES);
    expect(looped.outcome).toBe("nxdomain");
  });
});
