// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GROW, SHRINK } from "../src/graph/layout.js";
import { start } from "../src/ui/app.js";

// The page, booted. Everything else in spec/ tests a layer; this tests the
// wiring between them — that a press on the picture actually reaches the
// simulation, which is the one claim the whole pivot rests on and the one no
// unit test can make.

const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(
  readFileSync(resolve("index.html"), "utf8"),
)?.[1];

const boot = (width: number): Document => {
  document.body.innerHTML = body ?? "";

  // jsdom answers no media queries, so the layout has to be told which
  // viewport it is on. Narrow is the 390px marking viewport.
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width") && width <= 700,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;

  // The loop is not what is under test here: one frame's worth of wiring is,
  // and a real rAF would keep the world running between assertions.
  globalThis.requestAnimationFrame = () => 0;
  start();
  return document;
};

const press = (doc: Document, id: string): void => {
  const node = doc.querySelector<SVGGElement>(`[data-node="${id}"]`);
  expect(node, `no control for ${id}`).toBeTruthy();
  node?.dispatchEvent(new MouseEvent("click"));
};

const dots = (doc: Document): number =>
  doc.querySelectorAll(".node-dot").length;

describe("the page, booted", () => {
  let doc: Document;
  beforeEach(() => {
    doc = boot(1920);
  });

  it("opens at one machine per tier, because growth is the interaction", () => {
    expect(dots(doc)).toBe(1);
    expect(doc.querySelector('[data-node="root"]')).toBeTruthy();
    expect(doc.querySelector('[data-node="auth1"]')).toBeNull();
  });

  it("grows a tier when its control in the picture is pressed", () => {
    press(doc, `${GROW}authorities`);
    expect(doc.querySelector('[data-node="auth1"]')).toBeTruthy();
  });

  it("shrinks back, and never below one", () => {
    press(doc, `${GROW}users`);
    expect(dots(doc)).toBeGreaterThan(1);
    for (let i = 0; i < 8; i += 1) press(doc, `${SHRINK}users`);
    expect(dots(doc)).toBe(1);
  });

  it("opens a machine onto what it holds, and onto its knobs", () => {
    press(doc, "auth0");
    const panel = doc.querySelector(".inspector");
    expect(panel?.textContent).toMatch(/Authoritative for/);
    expect(panel?.querySelectorAll(".knob").length).toBeGreaterThan(1);
  });

  it("follows one query when a machine that asks is opened", () => {
    press(doc, "u0");
    expect(doc.querySelector("[data-log] .steps")).toBeTruthy();
    expect(doc.querySelector("svg")?.dataset.spotlight).toBe("true");
  });

  it("still fits its viewBox once grown on the phone", () => {
    const narrow = boot(390);
    press(narrow, `${GROW}users`);
    const box = narrow.querySelector("svg")?.getAttribute("viewBox");
    expect(box?.split(" ")[2]).toBe("420");
  });
});
