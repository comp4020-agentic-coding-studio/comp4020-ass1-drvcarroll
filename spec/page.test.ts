// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { start } from "../src/ui/app.js";
import { useViewport } from "./dom.js";

// The page, booted. Everything else in spec/ tests a layer; this tests the
// wiring between them, which is the one claim no unit test can make.
//
// Nothing here ever synthesises a drag, so a green suite is proof the keyboard
// path is complete on its own - which is what a marker actually does with it.

const html = readFileSync(resolve("index.html"), "utf8");

const node = (id: string): SVGGElement | null =>
  document.querySelector(`[data-node="${id}"]`);

const press = (id: string, key = "Enter"): void => {
  node(id)?.dispatchEvent(
    new window.KeyboardEvent("keydown", { key, bubbles: true }),
  );
};

const boot = (width = 1920): void => {
  document.documentElement.innerHTML = html;
  useViewport(width);
  start();
};

describe("the page boots", () => {
  beforeEach(() => {
    boot();
  });

  it("finds a stage to draw into", () => {
    expect(document.querySelector("[data-graph]")).toBeTruthy();
  });

  it("opens with two icons and a gap, and nothing else", () => {
    expect(
      [...document.querySelectorAll("[data-node]")].map((n) =>
        n.getAttribute("data-node"),
      ),
    ).toEqual(["server", "laptop"]);
  });

  it("opens with a suggestion and a silent mirror", () => {
    expect(
      document.querySelector("[data-prompt]")?.textContent?.trim(),
    ).toBeTruthy();
    const said = document.querySelector("[data-said]");
    expect(said?.getAttribute("aria-live")).toBe("polite");
    expect(said?.textContent?.trim()).toBeFalsy();
  });
});

describe("every entity opens by keyboard alone", () => {
  beforeEach(() => {
    boot();
  });

  it("makes each shape a real focusable button", () => {
    expect(node("laptop")?.getAttribute("role")).toBe("button");
    expect(node("laptop")?.getAttribute("tabindex")).toBe("0");
  });

  it("unfolds the laptop on Enter, revealing what is inside it", () => {
    press("laptop");
    for (const inner of ["git", "files", "index"]) {
      expect(node(inner), `${inner} should be inside the laptop`).toBeTruthy();
    }
  });

  it("unfolds on Space as well, without scrolling the page", () => {
    press("laptop", " ");
    expect(node("files")).toBeTruthy();
  });

  it("walks all the way in: laptop, files, index, .git", () => {
    for (const id of ["laptop", "files", "index", "git"]) press(id);
    expect(node("file:README.md")).toBeTruthy();
    expect(node("laptop")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("says what a closed entity is holding, so folding costs nothing", () => {
    expect(node("laptop")?.getAttribute("aria-label")).toContain("0 commits");
    press("laptop");
    press("files");
    press("laptop"); // an open entity is inspected, not toggled
    expect(node("file:README.md")).toBeTruthy();
  });

  it("moves the prompt on, and mirrors what happened", () => {
    const before = document.querySelector("[data-prompt]")?.textContent;
    press("laptop");
    expect(document.querySelector("[data-prompt]")?.textContent).not.toBe(
      before,
    );
    expect(document.querySelector("[data-said]")?.textContent).toContain(
      "open",
    );
  });
});

describe("opening a thing explains what it is", () => {
  beforeEach(() => {
    boot();
    press("laptop");
    press("files");
  });

  it("opens an inspector on an entity that is already open", () => {
    press("files");
    const inspector = document.querySelector(".inspector");
    expect(inspector?.hasAttribute("hidden")).toBe(false);
    expect(inspector?.querySelector(".what")?.textContent).toContain("edit");
  });

  it("offers folding it away as a verb in the inspector, not a toolbar", () => {
    press("files");
    expect(document.querySelectorAll("main > button")).toHaveLength(0);
    expect(
      document.querySelector(".inspector .verb")?.textContent,
    ).toContain("Fold");
  });

  it("folds the whole machine back up, contents included", () => {
    press("laptop"); // open, so this inspects
    document
      .querySelector<HTMLButtonElement>(".inspector .verb")
      ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(
      [...document.querySelectorAll("[data-node]")].map((n) =>
        n.getAttribute("data-node"),
      ),
    ).toEqual(["server", "laptop"]);
  });
});

describe("the phone gets the same picture, stacked", () => {
  it("draws every entity at 390 too", () => {
    boot(390);
    for (const id of ["laptop", "files", "index", "git"]) press(id);
    expect(node("file:README.md")).toBeTruthy();
    expect(node("server")).toBeTruthy();
  });
});
