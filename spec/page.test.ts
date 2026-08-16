// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { start } from "../src/ui/app.js";
import { useViewport } from "./dom.js";

// The page, booted. Everything else in spec/ tests a layer; this tests the
// wiring between them, which is the one claim no unit test can make.
//
// Nothing here ever synthesises a drag, and every action below is a click on a
// real button or a keystroke into a real field, so a green suite is proof the
// pointer-free path is complete - which is what a marker actually does with it.

const html = readFileSync(resolve("index.html"), "utf8");

const panel = (id: string): HTMLElement | null =>
  document.querySelector(`[data-panel="${id}"]`);

const revealed = (id: string): boolean =>
  panel(id)?.dataset["revealed"] === "true";

// Every verb on the page is a real <button>, so one lookup serves the header
// actions, the body verbs and the branch chips alike.
const buttons = (within: ParentNode | null): HTMLButtonElement[] =>
  within === null ? [] : [...within.querySelectorAll("button")];

const shown = (within: ParentNode | null): HTMLButtonElement[] =>
  buttons(within).filter((b) => !b.hidden);

const named = (within: ParentNode | null, label: string): HTMLButtonElement => {
  const found = shown(within).find((b) =>
    (b.textContent ?? "").startsWith(label),
  );
  if (found === undefined) throw new Error(`no button starting "${label}"`);
  return found;
};

const missing = (within: ParentNode | null, label: string): boolean =>
  !shown(within).some((b) => (b.textContent ?? "").startsWith(label));

const click = (target: Element): void => {
  target.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
};

const editor = (): HTMLTextAreaElement => {
  const found = document.querySelector<HTMLTextAreaElement>(".file-editor");
  if (found === null) throw new Error("no editor");
  return found;
};

const type = (field: HTMLTextAreaElement | HTMLInputElement, text: string) => {
  field.value = text;
  field.dispatchEvent(new window.Event("input", { bubbles: true }));
};

const rows = (id: string): HTMLElement[] => [
  ...(panel(id)?.querySelectorAll<HTMLElement>(".commit-row") ?? []),
];

const chips = (id: string): string[] =>
  [...(panel(id)?.querySelectorAll(".ref-chip") ?? [])].map(
    (c) => c.textContent ?? "",
  );

const hint = (): string => {
  const el = document.querySelector("[data-hint-do]");
  return el?.textContent ?? "";
};

const why = (): string =>
  document.querySelector("[data-hint-why]")?.textContent ?? "";

const said = (): string =>
  document.querySelector("[data-said]")?.textContent ?? "";

const next = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(".go-on");

const boot = (width = 1920): void => {
  document.documentElement.innerHTML = html;
  useViewport(width);
  start();
};

// The tour is four presses of one button, and nothing else on the page is
// interactive until it is done, so most tests want it over with.
const tour = (): void => {
  for (let i = 0; i < 8; i += 1) {
    const button = next();
    if (button === null) return;
    click(button);
  }
};

const pick = (path: string): void => {
  const item = [...document.querySelectorAll(".file-list li")].find((li) =>
    (li.textContent ?? "").startsWith(path),
  );
  if (item === undefined) throw new Error(`no file ${path}`);
  click(item);
};

// Edit, Save, Commit: the three steps that put a snapshot in .git, which almost
// every later assertion needs to have happened first.
const commit = (path: string, text: string, message: string): void => {
  pick(path);
  type(editor(), text);
  click(named(panel("files"), "Save"));
  const field = panel("index")?.querySelector<HTMLInputElement>(".message");
  if (field === null || field === undefined) throw new Error("no message");
  type(field, message);
  click(named(panel("index"), "Commit"));
};

describe("the page boots", () => {
  beforeEach(() => {
    boot();
  });

  it("finds a stage to draw into", () => {
    expect(document.querySelector("[data-graph]")).toBeTruthy();
  });

  it("draws all four entities", () => {
    for (const id of ["files", "index", "git", "server"]) {
      expect(panel(id)).toBeTruthy();
    }
  });

  it("titles every entity, so the process is named before it is run", () => {
    for (const id of ["files", "index", "git", "server"]) {
      expect(panel(id)?.querySelector(".panel-head")?.textContent).toBeTruthy();
    }
  });

  it("seeds enough files to read like a real project", () => {
    expect(document.querySelectorAll(".file-list li").length).toBeGreaterThan(3);
  });

  it("puts Gary beside the server, named", () => {
    const gary = document.querySelector("[data-actor='gary']");
    expect(gary).toBeTruthy();
    expect(panel("server")?.contains(gary as Node)).toBe(true);
    expect(gary?.textContent).toContain("Gary");
  });
});

describe("the tour introduces one entity at a time", () => {
  beforeEach(() => {
    boot();
  });

  it("opens with Your Files alone, and a way on", () => {
    expect(revealed("files")).toBe(true);
    expect(revealed("index")).toBe(false);
    expect(revealed("git")).toBe(false);
    expect(revealed("server")).toBe(false);
    expect(next()).toBeTruthy();
  });

  it("names the entity it has just revealed, beside it", () => {
    expect(hint()).toContain("Your Files");
    expect(why()).not.toBe("");
    expect(panel("files")?.querySelector("[data-hint-do]")).toBeTruthy();
  });

  it("reveals them in the direction a change travels", () => {
    const order = ["index", "git", "server"];
    for (const id of order) {
      click(next() as HTMLButtonElement);
      expect(revealed(id)).toBe(true);
    }
  });

  // The four panels divide one fixed viewport, so a hidden one has to keep its
  // box or the whole stack jumps on every reveal.
  it("keeps unrevealed entities in the layout rather than removing them", () => {
    expect(panel("server")?.isConnected).toBe(true);
  });

  it("retires the Next button once all four are named", () => {
    tour();
    expect(next()).toBeNull();
  });

  it("hands over to the curriculum, which asks for a real change", () => {
    tour();
    expect(hint()).toContain("Change a line");
    expect(panel("files")?.querySelector("[data-hint-do]")).toBeTruthy();
  });
});

describe("the core loop is the only thing on offer at first", () => {
  beforeEach(() => {
    boot();
    tour();
  });

  it("gives .git exactly Pull and Push", () => {
    const head = panel("git")?.querySelector(".panel-actions") ?? null;
    expect(shown(head).map((b) => b.textContent)).toEqual(["Pull", "Push"]);
  });

  it("never draws a branch as a verb", () => {
    expect(missing(panel("git"), "main")).toBe(true);
    expect(missing(panel("git"), "feature")).toBe(true);
  });

  it("holds back the advanced verbs until the loop has run", () => {
    expect(missing(panel("git"), "Branch")).toBe(true);
    expect(missing(panel("files"), "Put aside")).toBe(true);
    expect(missing(panel("git"), "Replay")).toBe(true);
    expect(missing(panel("git"), "Move the branch back")).toBe(true);
  });

  it("keeps the reversals that are not git verbs at page level", () => {
    expect(named(document.body, "Undo")).toBeTruthy();
    expect(named(document.body, "Start over")).toBeTruthy();
  });
});

describe("edit, save, commit", () => {
  beforeEach(() => {
    boot();
    tour();
  });

  it("notices an edit before anything is staged", () => {
    pick("README.md");
    type(editor(), "changed\n");
    expect(panel("index")?.textContent).toContain("Nothing staged");
    expect(hint()).toContain("Save");
  });

  it("stages on Save, and says where it went", () => {
    pick("README.md");
    type(editor(), "changed\n");
    click(named(panel("files"), "Save"));
    expect(panel("index")?.querySelectorAll(".blob-list li").length).toBe(1);
    expect(said()).toContain("README.md");
  });

  it("puts a commit in .git, carrying the message typed", () => {
    commit("README.md", "changed\n", "explain the readme");
    expect(rows("git").length).toBe(1);
    expect(rows("git")[0]?.textContent).toContain("explain the readme");
    expect(chips("git")).toContain("● main");
  });

  it("leaves the server empty until it is pushed to", () => {
    commit("README.md", "changed\n", "explain the readme");
    expect(rows("server").length).toBe(0);
    expect(hint()).toContain("Push");
  });
});

describe("Gary, two seconds after every push", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    boot();
    tour();
    commit("README.md", "changed\n", "explain the readme");
    click(named(panel("git"), "Push"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lands the push on the server first", () => {
    expect(rows("server").length).toBe(1);
  });

  it("has not pushed yet at one second", () => {
    vi.advanceTimersByTime(1000);
    expect(rows("server").length).toBe(1);
  });

  it("pushes a real commit at two, and says what it means", () => {
    vi.advanceTimersByTime(2000);
    expect(rows("server").length).toBe(2);
    expect(said()).toContain("Gary");
    expect(said()).toContain("refused");
  });

  it("refuses the next push, giving the reason", () => {
    vi.advanceTimersByTime(2000);
    click(named(panel("git"), "Push"));
    expect(said()).toContain("Refused");
    expect(said()).toContain("Pull");
    expect(rows("server").length).toBe(2);
  });

  it("brings his commit down on Pull without touching your files", () => {
    vi.advanceTimersByTime(2000);
    const before = editor().value;
    click(named(panel("git"), "Pull"));
    expect(chips("git")).toContain("origin/main");
    expect(editor().value).toBe(before);
    expect(said()).toContain("not changed");
  });

  // The whole reason his push has to be real: merging it has to put his line in
  // a file the visitor can then read.
  it("merges his line into your file", () => {
    vi.advanceTimersByTime(2000);
    click(named(panel("git"), "Pull"));
    click(named(panel("git"), "Merge origin/main"));
    pick("README.md");
    expect(editor().value).toContain("hi, my name is gary!");
  });

  it("opens the advanced verbs once the loop has closed", () => {
    vi.advanceTimersByTime(2000);
    click(named(panel("git"), "Pull"));
    click(named(panel("git"), "Merge origin/main"));
    expect(named(panel("git"), "Branch")).toBeTruthy();
    expect(named(panel("git"), "Move the branch back")).toBeTruthy();
  });

  it("pushes again after the next push, so the loop repeats", () => {
    vi.advanceTimersByTime(2000);
    click(named(panel("git"), "Pull"));
    click(named(panel("git"), "Merge origin/main"));
    commit("notes.md", "todo\n", "start the notes");
    click(named(panel("git"), "Push"));
    vi.advanceTimersByTime(2000);
    expect(rows("server").length).toBe(4);
  });

  it("cannot be overtaken by an undo", () => {
    click(named(document.body, "Undo"));
    vi.advanceTimersByTime(2000);
    expect(said()).not.toContain("Gary");
  });
});

describe("branches, once they have been earned", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    boot();
    tour();
    commit("README.md", "changed\n", "explain the readme");
    click(named(panel("git"), "Push"));
    vi.advanceTimersByTime(2000);
    click(named(panel("git"), "Pull"));
    click(named(panel("git"), "Merge origin/main"));
    vi.useRealTimers();
  });

  it("asks for a name only when Branch is pressed", () => {
    expect(panel("git")?.querySelector(".branch-controls .message")).toBeNull();
    click(named(panel("git"), "Branch"));
    expect(
      panel("git")?.querySelector(".branch-controls .message"),
    ).toBeTruthy();
  });

  it("pins the new name to the commit you were on", () => {
    click(named(panel("git"), "Branch"));
    const field = panel("git")?.querySelector<HTMLInputElement>(
      ".branch-controls .message",
    );
    type(field as HTMLInputElement, "spike");
    click(named(panel("git"), "Start a branch here"));
    expect(chips("git")).toContain("spike");
  });

  // The chip is the branch, so the chip is how you move onto it: one drawing of
  // a name pinned to a commit, doing the one thing that name can do.
  it("moves onto a branch by its own chip, from the keyboard", () => {
    click(named(panel("git"), "Branch"));
    const field = panel("git")?.querySelector<HTMLInputElement>(
      ".branch-controls .message",
    );
    type(field as HTMLInputElement, "spike");
    click(named(panel("git"), "Start a branch here"));
    const chip = named(panel("git"), "spike");
    expect(chip.tagName).toBe("BUTTON");
    chip.focus();
    expect(document.activeElement).toBe(chip);
    click(chip);
    expect(chips("git")).toContain("● spike");
  });

  it("leaves the branch you are on, and the server's names, as labels", () => {
    const current = [...(panel("git")?.querySelectorAll(".ref-chip") ?? [])];
    const label = current.find((c) => (c.textContent ?? "").includes("● main"));
    expect(label?.tagName).toBe("SPAN");
    const remote = current.find((c) => c.textContent === "origin/main");
    expect(remote?.tagName).toBe("SPAN");
  });

  it("refuses a checkout with unsaved work, and explains itself", () => {
    click(named(panel("git"), "Branch"));
    const field = panel("git")?.querySelector<HTMLInputElement>(
      ".branch-controls .message",
    );
    type(field as HTMLInputElement, "spike");
    click(named(panel("git"), "Start a branch here"));
    // A tracked file: git only refuses over work it would have to overwrite, so
    // an untracked one would rightly be let through.
    pick("README.md");
    type(editor(), "unsaved\n");
    click(named(panel("git"), "spike"));
    expect(said()).toContain("unsaved changes");
    expect(chips("git")).not.toContain("● spike");
  });

  it("offers the stash once there is something to put aside", () => {
    pick("notes.md");
    type(editor(), "unsaved\n");
    click(named(panel("files"), "Put aside"));
    expect(said()).toContain("clean");
    click(named(panel("files"), "Bring it back"));
    expect(said()).toContain("back in your files");
  });
});

describe("everything can be taken back", () => {
  beforeEach(() => {
    boot();
    tour();
  });

  it("undoes the last change to the model", () => {
    commit("README.md", "changed\n", "explain the readme");
    click(named(document.body, "Undo"));
    expect(rows("git").length).toBe(0);
  });

  it("returns to the world it started in", () => {
    commit("README.md", "changed\n", "explain the readme");
    click(named(document.body, "Start over"));
    expect(rows("git").length).toBe(0);
    expect(panel("index")?.textContent).toContain("Nothing staged");
  });
});

describe("on a phone", () => {
  beforeEach(() => {
    boot(390);
    tour();
  });

  it("draws the same four entities and the same verbs", () => {
    expect(document.querySelectorAll("[data-panel]").length).toBe(4);
    const head = panel("git")?.querySelector(".panel-actions") ?? null;
    expect(shown(head).map((b) => b.textContent)).toEqual(["Pull", "Push"]);
  });

  it("keeps the walkthrough inside the entity it points at", () => {
    expect(panel("files")?.querySelector("[data-hint-do]")).toBeTruthy();
  });
});
