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
