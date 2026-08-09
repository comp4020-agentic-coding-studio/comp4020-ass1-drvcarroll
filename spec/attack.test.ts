import { describe, expect, it } from "vitest";
import {
  DEMO_BITS,
  NO_DEFENCES,
  REAL_BITS,
  SCALE,
  forge,
  poison,
  realSpace,
  space,
  type AttackerConfig,
} from "../src/dns/attack.js";
import type { Question } from "../src/dns/types.js";

// The claim under test is narrow and it is the level's whole argument: a
// forged reply is believed on one number and nothing else.

const Q: Question = { name: "www.anu.edu.au.", type: "A" };

const attacker = (
  over: Partial<AttackerConfig> = {},
): AttackerConfig => ({
  threat: "offpath",
  defences: { ...NO_DEFENCES },
  zone: "anu.edu.au.",
  ns: "ns.attacker.example.",
  address: "203.0.113.66",
  guess: () => 0,
  ...over,
});

describe("what the attacker forges", () => {
  it("steals the delegation, not the address", () => {
    const records = poison(attacker());
    expect(records[0]?.type).toBe("NS");
    expect(records[0]?.name).toBe("anu.edu.au.");
    // The glue, without which the forged referral is unusable — the same
    // reason a real parent ships it.
    expect(records[1]).toMatchObject({ type: "A", data: "203.0.113.66" });
  });

  it("sends a referral, so one win captures every name in the zone", () => {
    const { response } = forge(attacker(), Q, 1);
    expect(response.kind).toBe("referral");
  });
});

describe("the race", () => {
  it("is not a race at all for someone on the wire", () => {
    for (const txid of [0, 7, 15, 4242]) {
      const result = forge(attacker({ threat: "onpath" }), Q, txid);
      expect(result.accepted).toBe(true);
      expect(result.quoted).toBe(txid);
    }
  });

  it("is lost off-path unless the guess is exactly right", () => {
    const guessing = attacker({ guess: () => 9 });
    expect(forge(guessing, Q, 9).accepted).toBe(true);
    expect(forge(guessing, Q, 8).accepted).toBe(false);
  });

  it("says which number it quoted and which one was wanted", () => {
    const lost = forge(attacker({ guess: () => 3 }), Q, 12);
    expect(lost.note).toContain("0x03");
    expect(lost.note).toContain("0x0C");
  });
});

describe("the defences", () => {
  it("squares the search space when ports are randomised, not doubles it", () => {
    const bare = { ...NO_DEFENCES };
    const hardened = { ports: true, dnssec: false };
    expect(space(hardened)).toBe(space(bare) ** 2);
    expect(realSpace(hardened)).toBe(realSpace(bare) ** 2);
  });

  it("keeps the demo's honesty factor exact", () => {
    expect(space(NO_DEFENCES) * SCALE).toBe(realSpace(NO_DEFENCES));
    expect(2 ** (REAL_BITS - DEMO_BITS)).toBe(SCALE);
  });

  // The order matters: DNSSEC does not make the attacker miss, it makes a hit
  // worthless. A test that only checked `accepted` would miss the distinction.
  it("throws out a forgery that won the race, once signed", () => {
    const signed = attacker({
      threat: "onpath",
      defences: { ports: false, dnssec: true },
    });
    const result = forge(signed, Q, 5);
    expect(result.quoted).toBe(5);
    expect(result.accepted).toBe(false);
    expect(result.note).toContain("signature");
  });
});
