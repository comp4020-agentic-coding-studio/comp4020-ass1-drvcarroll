import { describe, expect, it } from "vitest";
import { NO_DEFENCES, forge, type AttackerConfig } from "../src/dns/attack.js";
import type { Cache } from "../src/dns/cache.js";
import { resolve } from "../src/dns/resolve.js";
import type { Question, Zone } from "../src/dns/types.js";
import { LEVEL3_ZONES } from "../src/levels/level3.js";
import {
  ATTACKER_IP,
  ATTACKER_NS,
  LEVEL4_ZONES,
  STOLEN_ZONE,
  kaminskyName,
} from "../src/levels/level4.js";

// Every transaction ID the resolver picks is pinned here, so nothing in this
// file depends on a random draw going the tester's way.
const PINNED = 0x2a;
const ids = (): number => PINNED;

const attacker = (
  over: Partial<AttackerConfig> = {},
): AttackerConfig => ({
  threat: "onpath",
  defences: { ...NO_DEFENCES },
  zone: STOLEN_ZONE,
  ns: ATTACKER_NS,
  address: ATTACKER_IP,
  guess: () => PINNED,
  ...over,
});

// Races any query for a name in the stolen zone, on any hop above that zone —
// exactly the page's rule. A delegation is only credible from a parent, and
// once the resolver is asking the attacker there is nothing left to forge.
const intercepting =
  (config: AttackerConfig) => (q: Question, asked: Zone, txid: number) =>
    q.name.endsWith(STOLEN_ZONE) && asked.origin !== STOLEN_ZONE
      ? forge(config, q, txid)
      : undefined;

describe("level 4 leaves the earlier world intact", () => {
  it("keeps every level 3 zone and adds one twin", () => {
    for (const zone of LEVEL3_ZONES) {
      expect(
        LEVEL4_ZONES.some(
          (z) => z.origin === zone.origin && z.server === zone.server,
        ),
      ).toBe(true);
    }
    const claiming = LEVEL4_ZONES.filter((z) => z.origin === STOLEN_ZONE);
    expect(claiming).toHaveLength(2);
    // Same name, different nameserver. That is the only difference, and it is
    // the only thing the resolver has to go on.
    expect(new Set(claiming.map((z) => z.ns)).size).toBe(2);
  });

  it("resolves normally when nobody is attacking", () => {
    const result = resolve({ name: "anu.edu.au", type: "A" }, LEVEL4_ZONES, {
      cache: new Map() as Cache,
      txid: ids,
    });
    expect(result.outcome).toBe("answered");
    expect(result.answer[0]?.data).toBe("130.56.67.33");
  });
});

describe("a believed forgery is indistinguishable from an answer", () => {
  it("redirects the name it was fired at", () => {
    const result = resolve({ name: "anu.edu.au", type: "A" }, LEVEL4_ZONES, {
      cache: new Map() as Cache,
      txid: ids,
      intercept: intercepting(attacker()),
    });
    expect(result.outcome).toBe("answered");
    expect(result.answer[0]?.data).toBe(ATTACKER_IP);
    expect(result.steps.some((s) => s.kind === "forged")).toBe(true);
  });

  it("captures the whole zone, not one name", () => {
    const cache: Cache = new Map();
    // Kaminsky: attack a name nobody wants, win the delegation, and every
    // other name in the zone follows without a second forged packet.
    resolve({ name: kaminskyName(0), type: "A" }, LEVEL4_ZONES, {
      cache,
      txid: ids,
      intercept: intercepting(attacker()),
    });
    expect(cache.get(`${STOLEN_ZONE}|NS`)?.records[0]?.data).toBe(ATTACKER_NS);

    const later = resolve({ name: "www.anu.edu.au", type: "A" }, LEVEL4_ZONES, {
      cache,
      txid: ids,
    });
    expect(later.answer[0]?.data).toBe(ATTACKER_IP);
    // Nothing was forged this time. The lie is in the memory, not the packet.
    expect(later.steps.some((s) => s.kind === "forged")).toBe(false);
  });

  it("serves the other client from the same poisoned memory", () => {
    const cache: Cache = new Map();
    resolve({ name: kaminskyName(0), type: "A" }, LEVEL4_ZONES, {
      cache,
      txid: ids,
      intercept: intercepting(attacker()),
    });
    const other = resolve({ name: "anu.edu.au", type: "A" }, LEVEL4_ZONES, {
      cache,
      client: "stub2",
      txid: ids,
    });
    expect(other.answer[0]?.data).toBe(ATTACKER_IP);
  });
});

describe("a rejected forgery changes nothing", () => {
  it("is logged, then the real answer arrives anyway", () => {
    const missing = attacker({ threat: "offpath", guess: () => PINNED + 1 });
    const result = resolve({ name: "anu.edu.au", type: "A" }, LEVEL4_ZONES, {
      cache: new Map() as Cache,
      txid: ids,
      intercept: intercepting(missing),
    });
    expect(result.steps.some((s) => s.kind === "rejected")).toBe(true);
    expect(result.steps.some((s) => s.kind === "forged")).toBe(false);
    expect(result.answer[0]?.data).toBe("130.56.67.33");
  });

  it("does not poison the cache when DNSSEC fails a matching ID", () => {
    const cache: Cache = new Map();
    const signed = attacker({ defences: { ports: false, dnssec: true } });
    resolve({ name: "anu.edu.au", type: "A" }, LEVEL4_ZONES, {
      cache,
      txid: ids,
      intercept: intercepting(signed),
    });
    expect(cache.get(`${STOLEN_ZONE}|NS`)?.records[0]?.data).toBe(
      "ns1.anu.edu.au.",
    );
  });
});

describe("the Kaminsky name", () => {
  it("is different on every attempt, so nothing is ever a cache hit", () => {
    const names = new Set([0, 1, 2, 3].map(kaminskyName));
    expect(names.size).toBe(4);
    for (const name of names) expect(name.endsWith(".anu.edu.au")).toBe(true);
  });
});
