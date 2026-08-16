import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Mechanically-checkable lines from the assignment-1 spec. What the spec
// leaves to a person (viewport behaviour, "one strong idea", process
// legibility) isn't testable here.

const distPath = resolve("dist/index.html");
const page = (): Document =>
  new JSDOM(readFileSync(distPath, "utf8")).window.document;

describe("assignment 1: core interaction exists", () => {
  it("built the site", () => {
    expect(existsSync(distPath)).toBe(true);
  });

  it("marks a primary interactive control", () => {
    expect(
      page().querySelector('[data-testid="interaction"]'),
      'Tag the control the visitor uses with data-testid="interaction" — ' +
        "the spec asks for an interaction stated plainly enough to test.",
    ).toBeTruthy();
  });

  it("marks the region that changes in response", () => {
    expect(
      page().querySelector('[data-testid="output"]'),
      'Tag the region that changes when the visitor interacts with ' +
        'data-testid="output", so what "changes what they see" means is ' +
        "concrete.",
    ).toBeTruthy();
  });
});

// These assertions used to demand a step button, a seek-back and a speed
// slider, because the page walked a fixed sequence and the transport was how
// you drove it. They are inverted now, deliberately: the pivot's contract is
// that the verb *is* the progression. A stage advances because the visitor
// performed a real git operation on a real object, so any control whose only
// job is to move through the explanation is the thing that must not come back.
describe("assignment 1: the verb is the progression", () => {
  it.each([
    ["[data-next]", "a step control"],
    ["[data-back]", "a seek-back control"],
    ["[data-speed]", "a pacing control"],
  ])("offers no %s", (selector, what) => {
    expect(
      page().querySelector(selector),
      `A transport control (${what}) advances the visitor's position in a ` +
        "story about git rather than changing git. Progression is earned by " +
        "staging, committing and pushing, so this must stay absent.",
    ).toBeNull();
  });

  it("carries the interaction testid on the picture itself", () => {
    expect(
      page().querySelector('[data-graph][data-testid="interaction"]'),
      "The picture is the interaction: every verb lives in the inspector of " +
        "the object it acts on, so there is no separate control to tag.",
    ).toBeTruthy();
  });

  it("says at most two lines of prose outside the picture", () => {
    const doc = page();
    const prose = doc.querySelectorAll("main > p");
    expect(
      prose.length,
      "One suggestion of what to do next, one consequence of what just " +
        "happened. Explanation belongs in an inspector, where it costs " +
        "nothing until it is asked for.",
    ).toBeLessThanOrEqual(2);
  });
});
