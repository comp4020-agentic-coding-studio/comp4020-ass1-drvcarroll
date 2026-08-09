import { describe, expect, it } from "vitest";
import { buildZones, suffixesOf, type DohResponse } from "../src/dns/live.js";
import { RECURSOR, resolve } from "../src/dns/resolve.js";

// The DoH fetch is injected so these run offline. `pnpm check` must never
// depend on the network being up.

const NS = 2;
const A = 1;

const WORLD: Record<string, DohResponse> = {
  "au.|NS": {
    Status: 0,
    Answer: [{ name: "au.", type: NS, TTL: 172800, data: "q.au." }],
  },
  "anu.edu.au.|NS": {
    Status: 0,
    Answer: [
      { name: "anu.edu.au.", type: NS, TTL: 3600, data: "ns1.anu.edu.au." },
    ],
  },
  // edu.au really is a zone cut, so real names are four levels deep.
  "edu.au.|NS": {
    Status: 0,
    Answer: [{ name: "edu.au.", type: NS, TTL: 172800, data: "s.au." }],
  },
  "s.au.|A": {
    Status: 0,
    Answer: [{ name: "s.au.", type: A, TTL: 3600, data: "203.0.113.3" }],
  },
  "q.au.|A": {
    Status: 0,
    Answer: [{ name: "q.au.", type: A, TTL: 3600, data: "203.0.113.1" }],
  },
  "ns1.anu.edu.au.|A": {
    Status: 0,
    Answer: [{ name: "ns1.anu.edu.au.", type: A, TTL: 3600, data: "203.0.113.2" }],
  },
  "anu.edu.au.|A": {
    Status: 0,
    Answer: [{ name: "anu.edu.au.", type: A, TTL: 280, data: "130.56.65.114" }],
  },
  // The real answer arrives via a CNAME, so the A is named for the alias.
  "www.anu.edu.au.|A": {
    Status: 0,
    Answer: [
      {
        name: "www.anu.edu.au.",
        type: 5,
        TTL: 280,
        data: "terra-web.anu.edu.au.",
      },
      {
        name: "terra-web.anu.edu.au.",
        type: A,
        TTL: 280,
        data: "130.56.65.113",
      },
    ],
  },
};

const fakeFetch = async (url: string): Promise<DohResponse> => {
  const params = new URL(url).searchParams;
  const key = `${params.get("name") ?? ""}|${params.get("type") ?? ""}`;
  return WORLD[key] ?? { Status: 3 };
};

describe("suffixesOf walks the name from the root down", () => {
  it("lists every suffix root first, including the name itself", () => {
    // The name itself must be offered: an apex like anu.edu.au. is a zone
    // cut, and skipping it seats the address in the TLD's zone.
    expect(suffixesOf("www.anu.edu.au")).toEqual([
      ".",
      "au.",
      "edu.au.",
      "anu.edu.au.",
      "www.anu.edu.au.",
    ]);
  });
});

describe("real delegation data rebuilds the walk", () => {
  it("keeps only the suffixes that are actually zone cuts", async () => {
    const { cuts } = await buildZones("www.anu.edu.au", fakeFetch);
    expect(cuts).toEqual([".", "au.", "edu.au.", "anu.edu.au."]);
  });

  it("reuses the authoritative seat when the tree runs deeper than it", async () => {
    const { zones } = await buildZones("www.anu.edu.au", fakeFetch);
    expect(zones.map((z) => z.server)).toEqual(["root", "tld", "auth", "auth"]);
  });

  // An apex name is a zone of its own. Stopping the scan one level early
  // skipped the TLD hop and put the address in the TLD's zone, which says
  // the wrong thing about who is authoritative for it.
  it("does not skip a delegation when the name has no host label", async () => {
    const { cuts, zones } = await buildZones("anu.edu.au", fakeFetch);

    expect(cuts).toEqual([".", "au.", "edu.au.", "anu.edu.au."]);
    expect(zones.map((z) => z.server)).toEqual(["root", "tld", "auth", "auth"]);
    expect(zones.at(-1)?.origin).toBe("anu.edu.au.");
  });

  it("answers the name that was asked, even behind a CNAME", async () => {
    const { zones } = await buildZones("www.anu.edu.au", fakeFetch);
    expect(zones.at(-1)?.records).toEqual([
      { name: "www.anu.edu.au.", type: "A", ttl: 280, data: "130.56.65.113" },
    ]);
  });

  it("carries the real nameserver names, addresses and TTLs", async () => {
    const { zones } = await buildZones("www.anu.edu.au", fakeFetch);
    const root = zones[0];
    expect(root?.records).toContainEqual({
      name: "au.",
      type: "NS",
      ttl: 172800,
      data: "q.au.",
    });
    expect(root?.records.some((r) => r.data === "203.0.113.1")).toBe(true);
  });

  it("feeds the same resolver the canned world uses", async () => {
    const { zones } = await buildZones("www.anu.edu.au", fakeFetch);
    const result = resolve({ name: "www.anu.edu.au", type: "A" }, zones);

    expect(result.outcome).toBe("answered");
    expect(result.answer[0]?.data).toBe("130.56.65.113");
    expect(
      result.steps
        .filter((s) => s.kind === "query" && s.from === RECURSOR)
        .map((s) => s.to),
    ).toEqual(["root", "tld", "auth", "auth"]);
  });

  it("returns NXDOMAIN for a name the real tree does not hold", async () => {
    const { zones } = await buildZones("nope.anu.edu.au", fakeFetch);
    expect(resolve({ name: "nope.anu.edu.au", type: "A" }, zones).outcome).toBe(
      "nxdomain",
    );
  });
});
