import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Mechanically-checkable lines from the assignment-1 spec. What the spec
// leaves to a person (viewport behaviour, "one strong idea", process
// legibility) isn't testable here — see the retro-prep notes instead.

const distPath = resolve("dist/index.html");

describe("assignment 1: core interaction exists", () => {
  it("built the site", () => {
    expect(existsSync(distPath)).toBe(true);
  });

  it("marks a primary interactive control", () => {
    const doc = new JSDOM(readFileSync(distPath, "utf8")).window.document;
    expect(
      doc.querySelector('[data-testid="interaction"]'),
      'Tag the control the visitor uses with data-testid="interaction" — ' +
        "the spec asks for an interaction stated plainly enough to test.",
    ).toBeTruthy();
  });

  it("marks the region that changes in response", () => {
    const doc = new JSDOM(readFileSync(distPath, "utf8")).window.document;
    expect(
      doc.querySelector('[data-testid="output"]'),
      'Tag the region that changes when the visitor interacts with ' +
        'data-testid="output", so what "changes what they see" means is concrete.',
    ).toBeTruthy();
  });
});

// The visitor drives the walk rather than watching it, so the controls that
// make that true are part of the contract. Only the static ones can be
// asserted here — the machines become buttons at runtime, and standing up a
// DOM that fetches real DNS to prove it would test the network, not the page.
describe("assignment 1: the visitor drives the resolution", () => {
  const page = (): Document =>
    new JSDOM(readFileSync(distPath, "utf8")).window.document;

  it("advances one message at a time from a single control", () => {
    const doc = page();
    expect(
      doc.querySelector('[data-next][data-testid="interaction"]'),
      "The step control is the core interaction, so it carries the " +
        "interaction testid rather than the lookup form's submit button.",
    ).toBeTruthy();
  });

  it("can be stepped backwards as well as forwards", () => {
    expect(
      page().querySelector("[data-back]"),
      "Seeking back is how a visitor re-reads a message they advanced " +
        "past. Without it the walk is a one-way animation again.",
    ).toBeTruthy();
  });

  it("offers a speed control whose lowest setting is manual", () => {
    const speed = page().querySelector("[data-speed]");
    expect(speed, "The pacing control is missing.").toBeTruthy();
    expect(
      speed?.getAttribute("min"),
      "Zero is manual — the slider carries the mode as well as the rate, " +
        "so its floor has to be 0 rather than a slowest non-zero speed.",
    ).toBe("0");
  });

  it("no longer stacks a cache panel beside the graph", () => {
    expect(
      page().querySelector("[data-cache]"),
      "The cache belongs to the resolver and is opened from it. A " +
        "standalone panel means that fold got undone.",
    ).toBeNull();
  });
});
