import { describe, expect, it } from "vitest";
import { resolve, respond } from "../src/dns/resolve.js";
import { LEVEL1, ZONES } from "../src/levels/level1.js";
import { LEVEL2, LEVEL2_ZONES } from "../src/levels/level2.js";
import type { Zone } from "../src/dns/types.js";

// Level 2's subject is the record type. These pin what each type does
// differently, because "the answer is not always an address" is the lesson.

const zoneOf = (origin: string): Zone => {
  const zone = LEVEL2_ZONES.find((z) => z.origin === origin);
  if (zone === undefined) throw new Error(`no zone named ${origin}`);
  return zone;
};

describe("level 2 extends level 1's world without rewriting it", () => {
  it("leaves level 1's zones untouched", () => {
    const l1 = ZONES.find((z) => z.origin === "anu.edu.au.");
    expect(l1?.records.some((r) => r.type === "MX")).toBe(false);
    expect(LEVEL1.zones).not.toBe(LEVEL2.zones);
  });

  it("keeps every record level 1 taught", () => {
    for (const zone of ZONES) {
      expect(zoneOf(zone.origin).records).toEqual(
        expect.arrayContaining(zone.records),
      );
    }
  });
});

describe("a parent refers rather than answers for a delegated name", () => {
  // The TLD holds NS records for anu.edu.au., but they are the delegation,
  // not an authoritative answer. Answering from them would teach that the
  // parent speaks for the child.
  it("refers when asked for the NS records it delegated", () => {
    const response = respond(zoneOf("au."), {
      name: "anu.edu.au.",
      type: "NS",
    });
    expect(response.kind).toBe("referral");
  });

  it("reaches the authoritative server for its own NS set", () => {
    const result = resolve({ name: "anu.edu.au", type: "NS" }, LEVEL2_ZONES);
    expect(result.outcome).toBe("answered");
    expect(result.steps.filter((s) => s.to === "auth").length).toBeGreaterThan(
      0,
    );
  });
});

describe("the type decides what comes back", () => {
  it("returns a mail exchanger, priority and all, for MX", () => {
    const result = resolve({ name: "anu.edu.au", type: "MX" }, LEVEL2_ZONES);
    expect(result.outcome).toBe("answered");
    expect(result.answer[0]?.data).toBe(
      "10 anu-edu-au.mail.protection.outlook.com.",
    );
  });

  it("restarts the walk when the answer is an alias", () => {
    const result = resolve(
      { name: "www.anu.edu.au", type: "A" },
      LEVEL2_ZONES,
    );
    expect(result.steps.filter((s) => s.kind === "cname")).toHaveLength(1);
    expect(result.answer[0]?.data).toBe("130.56.67.33");
  });

  // The distinction the real anu.edu.au forced: it has no CNAME, and saying
  // it does not exist would be a different and false claim.
  it("says NODATA, not NXDOMAIN, for a name with no record of that type", () => {
    const result = resolve({ name: "anu.edu.au", type: "CNAME" }, LEVEL2_ZONES);
    expect(result.outcome).toBe("nodata");
    const empty = result.steps.find((s) => s.kind === "nodata");
    expect(empty?.records.some((r) => r.type === "SOA")).toBe(true);
  });

  it("hands back the SOA when the name does not exist", () => {
    const result = resolve(
      { name: "nope.anu.edu.au", type: "A" },
      LEVEL2_ZONES,
    );
    expect(result.outcome).toBe("nxdomain");
    const denial = result.steps.find((s) => s.kind === "nxdomain");
    expect(denial?.records.some((r) => r.type === "SOA")).toBe(true);
  });
});

describe("only some answers are somewhere you can go", () => {
  // Knowing who runs a zone is not an address. Leaving NS and SOA out of
  // `destinations` is what stops the page drawing a connection that a real
  // machine could never open.
  it("sends A to the web server and MX to the mail server", () => {
    expect(LEVEL2.destinations.A).toBe("origin");
    expect(LEVEL2.destinations.MX).toBe("mail");
  });

  it("gives NS and SOA nowhere to connect", () => {
    expect(LEVEL2.destinations.NS).toBeUndefined();
    expect(LEVEL2.destinations.SOA).toBeUndefined();
  });

  it("draws no edge to a destination before the walk hands one back", () => {
    for (const node of Object.values(LEVEL2.destinations)) {
      expect(LEVEL2.deferredEdges.has(`stub:${node}`)).toBe(true);
    }
  });
});
