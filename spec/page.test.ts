// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { start } from "../src/ui/app.js";

// The page, booted. Everything else in spec/ tests a layer; this tests the
// wiring between them, which is the one claim no unit test can make.
//
// It is nearly empty on purpose: the canvas arrives at step 6 and the verbs at
// step 7, and this grows a keyboard-only walk through the stages as they land.
// Nothing here ever synthesises a drag, so a green suite is proof the keyboard
// path is complete, which is what a marker actually does with it.

const html = readFileSync(resolve("index.html"), "utf8");

describe("the page boots", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = html;
  });

  it("finds a stage to draw into", () => {
    expect(document.querySelector("[data-graph]")).toBeTruthy();
  });

  it("starts without throwing", () => {
    expect(() => {
      start();
    }).not.toThrow();
  });

  it("opens with a suggestion and a silent mirror", () => {
    const prompt = document.querySelector("[data-prompt]");
    const said = document.querySelector("[data-said]");
    expect(prompt?.textContent?.trim()).toBeTruthy();
    expect(said?.getAttribute("aria-live")).toBe("polite");
    expect(
      said?.textContent?.trim(),
      "Nothing has happened yet, so the mirror says nothing.",
    ).toBeFalsy();
  });
});
