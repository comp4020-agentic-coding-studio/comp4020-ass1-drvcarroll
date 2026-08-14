import { describe, expect, it } from "vitest";
import { NO_DEFENCES } from "../src/dns/attack.js";
import { createSim, stepTo } from "../src/sim/engine.js";
import { TLD } from "../src/sim/topology.js";
import type { SimConfig } from "../src/sim/types.js";
import { band, headline, nodeMetric, perSecond } from "../src/ui/readouts.js";

// The headline is the only prose the page keeps, so what it says is a claim
// like any other and gets asserted like one.

const base: SimConfig = {
  seed: 1,
  users: 4,
  resolvers: 1,
  authorities: 4,
  ratePerUser: 1,
  ttl: 300,
  mix: ["A"],
  attacker: "off",
  defences: NO_DEFENCES,
  capacity: {},
  offline: [],
};

describe("rates, formatted", () => {
  it("keeps a decimal where one carries information, and drops it where it does not", () => {
    expect(perSecond(0)).toBe("0 q/s");
    expect(perSecond(0.42)).toBe("0.4 q/s");
    expect(perSecond(137.4)).toBe("137 q/s");
  });

  it("bands on absolute rates, so growth cannot repaint everything calm", () => {
    expect(band(1)).toBe("ok");
    expect(band(8)).toBe("hot");
    expect(band(40)).toBe("over");
  });
});

describe("the headline", () => {
  it("leads with the number the page is an argument about", () => {
    const state = createSim({ ...base, ttl: 3600 });
    stepTo(state, 300);
    expect(headline(state)).toMatch(/answered from memory/);
    expect(headline(state)).toMatch(/^1,\d\d\d queries/);
  });

  it("stays silent about damage that has not happened", () => {
    const state = createSim(base);
    stepTo(state, 60);
    expect(headline(state)).not.toMatch(/lie|dropped/);
  });

  it("says so once it has", () => {
    const state = createSim({ ...base, attacker: "onpath", users: 10 });
    stepTo(state, 120);
    expect(headline(state)).toMatch(/served a lie/);
  });

  it("puts a machine's own load on the machine", () => {
    const state = createSim({ ...base, ttl: 1, users: 10, ratePerUser: 2 });
    stepTo(state, 60);
    expect(nodeMetric(state, TLD)).toMatch(/q\/s$/);
    expect(nodeMetric(state, TLD)).not.toBe("0 q/s");
  });
});
