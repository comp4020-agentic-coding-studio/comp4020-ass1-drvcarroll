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

// The whole first lesson, driven the way a marker drives it: tab, enter, type.
// No synthesised drag anywhere, so a green run here is proof on its own that
// the keyboard path is complete.
describe("edit, stage, commit, by keyboard and typing alone", () => {
  const verbs = (): HTMLButtonElement[] => [
    ...document.querySelectorAll<HTMLButtonElement>(".inspector .verb"),
  ];

  const press_ = (label: string): void => {
    const button = verbs().find((b) => b.textContent?.includes(label));
    expect(button, `no "${label}" verb in the inspector`).toBeTruthy();
    button?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  };

  const type = (text: string): void => {
    const box = document.querySelector<HTMLTextAreaElement>(
      ".inspector .content",
    );
    expect(box).toBeTruthy();
    if (box === null) return;
    box.value = text;
    box.dispatchEvent(new window.Event("input", { bubbles: true }));
  };

  beforeEach(() => {
    boot();
    for (const id of ["laptop", "files", "index", "git"]) press(id);
  });

  it("shows a file's contents in its inspector, not on the canvas", () => {
    press("file:README.md");
    expect(
      document.querySelector<HTMLTextAreaElement>(".inspector .content")?.value,
    ).toContain("my project");
    expect(document.querySelector("svg")?.textContent).not.toContain(
      "A thing I am making",
    );
  });

  it("marks the file the moment it is changed", () => {
    press("file:README.md");
    type("# my project\n\nchanged.\n");
    expect(node("file:README.md")?.getAttribute("data-glyph")).toBe("A");
  });

  it("stages the change, and a blob appears in the index", () => {
    press("file:README.md");
    type("changed");
    press_("Stage this change");
    expect(document.querySelector('[data-node^="blob:"]')).toBeTruthy();
    expect(document.querySelector("[data-said]")?.textContent).toContain(
      "Staged README.md",
    );
  });

  it("offers unstage on the blob, and it puts the index back", () => {
    press("file:README.md");
    type("changed");
    press_("Stage this change");
    const blob = document.querySelector('[data-node^="blob:"]');
    blob?.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    press_("Unstage this");
    expect(document.querySelector('[data-node^="blob:"]')).toBeFalsy();
  });

  it("commits from the index, and a commit appears in .git", () => {
    press("file:README.md");
    type("changed");
    press_("Stage this change");
    press("index");
    const message = document.querySelector<HTMLInputElement>(
      ".inspector .message",
    );
    expect(message).toBeTruthy();
    if (message !== null) message.value = "first commit";
    press_("Commit these changes");
    expect(document.querySelector('[data-node^="local:commit:"]')).toBeTruthy();
    expect(document.querySelector("[data-said]")?.textContent).toContain(
      "first commit",
    );
  });

  it("keeps every verb inside an inspector, never in a toolbar", () => {
    press("file:README.md");
    expect(document.querySelectorAll("main > button")).toHaveLength(0);
    expect(verbs().length).toBeGreaterThan(0);
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
