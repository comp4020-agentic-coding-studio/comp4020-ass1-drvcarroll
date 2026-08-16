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

// The whole core loop, walked the way the walkthrough now insists it be walked:
// commit, push, a teammate replies, your own second commit, then the merge that
// settles it. Nothing past this point is reachable until it has happened, so
// every later test starts from here rather than from a shortcut through it.
const core = (): void => {
  commit("README.md", "changed\n", "explain the readme");
  click(named(panel("git"), "Push"));
  vi.advanceTimersByTime(2000);
  // The refused push and the pull that answers it: the visitor performs both,
  // which is what marks the diverged stage met.
  click(named(panel("git"), "Push"));
  click(named(panel("git"), "Pull"));
  commit("notes.md", "todo\n", "start the notes");
  click(named(panel("git"), "Merge origin/main into main"));
  const field = panel("index")?.querySelector<HTMLInputElement>(".message");
  if (field === null || field === undefined) throw new Error("no message");
  type(field, "merge bonnie");
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

  it("puts the teammates beside the server, named", () => {
    const bonnie = document.querySelector("[data-actor='bonnie']");
    expect(bonnie).toBeTruthy();
    expect(panel("server")?.contains(bonnie as Node)).toBe(true);
    expect(bonnie?.textContent).toContain("Bonnie");
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
    expect(hint()).toContain("Click a file");
    expect(panel("files")?.querySelector("[data-hint-do]")).toBeTruthy();
  });
});

// Doing exactly and only what each instruction says, from the first press to
// the last. This is the test that would have caught every narrative bug so far:
// a prompt met by something the visitor never did, a prompt naming a state
// instead of a button, and a prompt naming a button that two buttons answer to.
// Every step below is the literal text of the hint that was on screen, and the
// assertion after it is that the hint moved on.
describe("every instruction can be followed, and moves the story on", () => {
  it("walks the whole curriculum by its own prompts", () => {
    vi.useFakeTimers();
    boot();
    tour();
    const seen: string[] = [];
    // Each instruction has to leave a different one behind it. A repeat means
    // the visitor did as told and the page ignored them.
    const step = (instruction: string, act: () => void): void => {
      expect(hint()).not.toBe("");
      expect(seen).not.toContain(hint());
      expect(hint()).toContain(instruction);
      seen.push(hint());
      act();
      expect(hint()).not.toBe(seen.at(-1));
    };

    step("Click a file", () => {
      commit("README.md", "changed\n", "explain the readme");
    });
    step("Press Push", () => {
      click(named(panel("git"), "Push"));
      // The teammate the next instruction talks about. Until they have really
      // pushed, the prompt says so rather than naming a Pull that is dead.
      expect(hint()).toContain("Nothing new from anyone else");
      vi.advanceTimersByTime(2000);
    });
    step("Press Push to see it refused, then press Pull", () => {
      click(named(panel("git"), "Push"));
      expect(said()).toContain("Refused");
      click(named(panel("git"), "Pull"));
    });
    step("Click another file", () => {
      commit("notes.md", "todo\n", "start the notes");
    });
    step("Press Merge origin/main into main", () => {
      click(named(panel("git"), "Merge origin/main into main"));
      const field = panel("index")?.querySelector<HTMLInputElement>(".message");
      type(field as HTMLInputElement, "merge bonnie");
      click(named(panel("index"), "Commit"));
    });
    step("Press Branch", () => {
      click(named(panel("git"), "Branch"));
      const field = panel("git")?.querySelector<HTMLInputElement>(
        ".branch-controls .message",
      );
      type(field as HTMLInputElement, "spike");
      click(named(panel("git"), "Start a branch here"));
    });
    step("Click the spike chip", () => {
      click(named(panel("git"), "spike"));
    });
    step("Put aside", () => {
      pick("styles.css");
      type(editor(), "body { color: red }\n");
      click(named(panel("files"), "Put aside"));
    });
    step("click the main chip", () => {
      commit("main.ts", "console.log('spike');\n", "spike work");
      click(named(panel("git"), "main"));
      commit("package.json", '{ "name": "x" }\n', "main work");
    });
    step("press Replay spike onto main", () => {
      click(named(panel("git"), "spike"));
      click(named(panel("git"), "Replay spike onto main"));
    });
    step("Change README.md", () => {
      commit("README.md", "spike line\n", "readme on spike");
      click(named(panel("git"), "main"));
      commit("README.md", "main line\n", "readme on main");
    });
    step("Press Merge spike into main", () => {
      click(named(panel("git"), "Merge spike into main"));
    });

    // Twelve instructions, all followed, and the scaffolding retires.
    expect(seen).toHaveLength(12);
    expect(hint()).toBe("");
    vi.useRealTimers();
  });
});

// The walkthrough is a lock, not a suggestion: the only things that can be
// touched are the things the current instruction named. Every control carries
// the name of the verb it is, so these read the page the way lock() writes it.
describe("nothing but what the instruction says", () => {
  const controls = (name: string): HTMLElement[] => [
    ...document.querySelectorAll<HTMLElement>(`[data-control="${name}"]`),
  ];

  const dead = (name: string): boolean =>
    controls(name).length > 0 &&
    controls(name).every(
      (el) =>
        el.hasAttribute("data-locked") &&
        (!("disabled" in el) || el.disabled === true),
    );

  const live = (name: string): boolean =>
    controls(name).some((el) => !el.hasAttribute("data-locked"));

  beforeEach(() => {
    vi.useFakeTimers();
    boot();
  });

  it("locks the whole page while the tour is still naming things", () => {
    for (const name of ["files", "save", "commit", "push", "pull"]) {
      expect(dead(name)).toBe(true);
    }
    expect(next()).toBeTruthy(); // the tour's own button is the way out
  });

  it("opens only the files when the first instruction is to edit one", () => {
    tour();
    expect(live("files")).toBe(true);
    for (const name of ["save", "commit", "push", "pull", "branch"]) {
      expect(dead(name)).toBe(true);
    }
  });

  it("opens Save only once the instruction has moved on to it", () => {
    tour();
    expect(dead("save")).toBe(true);
    pick("README.md");
    type(editor(), "changed\n");
    expect(hint()).toContain("Save");
    expect(live("save")).toBe(true);
    expect(dead("push")).toBe(true);
  });

  it("keeps branching shut until the collaboration loop has closed", () => {
    tour();
    commit("README.md", "changed\n", "explain the readme");
    expect(dead("branch")).toBe(true);
    core();
    expect(hint()).toContain("Branch");
    expect(live("branch")).toBe(true);
    expect(dead("push")).toBe(true);
  });

  // Reversal is the one thing the lock never takes away: a visitor who cannot
  // back out of a step stops poking the model.
  it("leaves Undo alone whatever the instruction says", () => {
    tour();
    pick("README.md");
    type(editor(), "changed\n");
    const undo = document.querySelector<HTMLButtonElement>(".take-back");
    expect(undo?.disabled).toBe(false);
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

  it("keeps the reversal that is not a git verb at page level", () => {
    expect(named(document.body, "Undo")).toBeTruthy();
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

describe("a teammate, two seconds after every push", () => {
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
    expect(said()).toContain("Bonnie");
    expect(said()).toContain("refused");
  });

  it("refuses the next push, giving the reason", () => {
    vi.advanceTimersByTime(2000);
    click(named(panel("git"), "Push"));
    expect(said()).toContain("Refused");
    expect(said()).toContain("Pull");
    expect(rows("server").length).toBe(2);
  });

  it("brings their commit down on Pull without touching your files", () => {
    vi.advanceTimersByTime(2000);
    const before = editor().value;
    click(named(panel("git"), "Pull"));
    expect(chips("git")).toContain("origin/main");
    expect(editor().value).toBe(before);
    expect(said()).toContain("not changed");
  });

  // The whole reason their push has to be real: merging it has to put their
  // line in a file the visitor can then read.
  it("merges their line into your file", () => {
    vi.advanceTimersByTime(2000);
    click(named(panel("git"), "Pull"));
    click(named(panel("git"), "Merge origin/main"));
    pick("README.md");
    expect(editor().value).toContain("hi, my name is bonnie!");
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
    expect(said()).not.toContain("Bonnie");
  });

  // The narrative used to dead-end here. Merging a teammate who committed on
  // top of you is a fast-forward, so no two-parent commit ever formed, so the
  // merge stage could never be met and the prompt repeated itself forever
  // however exactly the visitor followed it. The cure is the order of the
  // lesson: your own second commit is what makes the merge a merge.
  it("asks for your own second commit before it asks for a merge", () => {
    vi.advanceTimersByTime(2000);
    click(named(panel("git"), "Push"));
    click(named(panel("git"), "Pull"));
    expect(hint()).toContain("Click another file");
  });

  it("asks for the merge only once both sides have moved", () => {
    vi.advanceTimersByTime(2000);
    click(named(panel("git"), "Push"));
    click(named(panel("git"), "Pull"));
    commit("notes.md", "todo\n", "start the notes");
    expect(hint()).toContain("Merge origin/main into main");
    expect(hint()).toContain("Commit");
  });

  it("seals a real two-parent commit, and moves the narrative on", () => {
    vi.advanceTimersByTime(2000);
    click(named(panel("git"), "Push"));
    click(named(panel("git"), "Pull"));
    commit("notes.md", "todo\n", "start the notes");
    click(named(panel("git"), "Merge origin/main into main"));
    const field = panel("index")?.querySelector<HTMLInputElement>(".message");
    if (field === null || field === undefined) throw new Error("no message");
    type(field, "merge bonnie");
    click(named(panel("index"), "Commit"));
    // The stage is met, so the prompt has to have moved off the merge.
    expect(hint()).not.toContain("merge");
    expect(named(panel("git"), "Branch")).toBeTruthy();
  });
});

// One teammate replies per push, in a fixed rotation, so a refused push is
// always attributable to exactly one person rather than a pile-up.
describe("the teammates take turns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    boot();
    tour();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws both beside the server, named", () => {
    for (const name of ["Bonnie", "Clyde"]) {
      const actor = document.querySelector(`[data-actor='${name.toLowerCase()}']`);
      expect(actor).toBeTruthy();
      expect(panel("server")?.contains(actor as Node)).toBe(true);
      expect(actor?.textContent).toContain(name);
    }
  });

  it("sends exactly one of them per push, in order", () => {
    const settle = (path: string, message: string): void => {
      click(named(panel("git"), "Pull"));
      const merge = named(panel("git"), "Merge origin/main");
      if (merge !== null) click(merge);
      const field = panel("index")?.querySelector<HTMLInputElement>(".message");
      if (field === null || field === undefined) throw new Error("no message");
      type(field, message);
      const commitNow = named(panel("index"), "Commit");
      if (commitNow !== null) click(commitNow);
      void path;
    };

    commit("README.md", "changed\n", "explain the readme");
    const before = rows("server").length;
    click(named(panel("git"), "Push"));
    vi.advanceTimersByTime(2000);
    expect(said()).toContain("Bonnie");
    expect(said()).not.toContain("Clyde");
    // Exactly one commit arrived, so only one of them pushed.
    expect(rows("server").length).toBe(before + 2);

    settle("README.md", "merge bonnie");
    click(named(panel("git"), "Push"));
    vi.advanceTimersByTime(2000);
    expect(said()).toContain("Clyde");
    expect(said()).not.toContain("Bonnie");

    // Two of them, so the third push comes back round to the first.
    settle("README.md", "merge clyde");
    click(named(panel("git"), "Push"));
    vi.advanceTimersByTime(2000);
    expect(said()).toContain("Bonnie");
    expect(said()).not.toContain("Clyde");
  });
});

describe("branches, once they have been earned", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    boot();
    tour();
    core();
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

  it("undo can be pressed repeatedly, back to the world it started in", () => {
    commit("README.md", "changed\n", "explain the readme");
    click(named(document.body, "Undo"));
    click(named(document.body, "Undo"));
    click(named(document.body, "Undo"));
    expect(rows("git").length).toBe(0);
    expect(panel("index")?.textContent).toContain("Nothing staged");
  });
});

// Pull was pressable the moment anything had been pushed, including your own
// push, so a visitor could answer "press Push, see it refused, then press Pull"
// by pressing Pull on their own commit two seconds early - fetching nothing,
// learning nothing, and skipping the refusal that is the entire lesson. Pull
// now goes dead until somebody else's commit is genuinely up there.
describe("Pull is dead until there is something to pull", () => {
  const pull = (): HTMLButtonElement => named(panel("git"), "Pull");

  beforeEach(() => {
    vi.useFakeTimers();
    boot();
    tour();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is dead on an empty server", () => {
    expect(pull().disabled).toBe(true);
  });

  it("stays dead after your own push, because you already have it all", () => {
    commit("README.md", "changed\n", "explain the readme");
    click(named(panel("git"), "Push"));
    expect(rows("server").length).toBe(1);
    expect(pull().disabled).toBe(true);
  });

  it("comes alive only once a teammate has pushed", () => {
    commit("README.md", "changed\n", "explain the readme");
    click(named(panel("git"), "Push"));
    vi.advanceTimersByTime(2000);
    expect(pull().hasAttribute("data-off")).toBe(false);
    expect(pull().disabled).toBe(false);
  });

  it("goes dead again once their commit is in .git", () => {
    commit("README.md", "changed\n", "explain the readme");
    click(named(panel("git"), "Push"));
    vi.advanceTimersByTime(2000);
    click(pull());
    expect(chips("git")).toContain("origin/main");
    expect(pull().disabled).toBe(true);
  });

  // The stage it guards: reaching "diverged" has to mean the refusal was seen,
  // not that Pull happened to be pressable.
  // A stage stays met once met, so undoing the push puts this instruction back
  // in front of a visitor whose commit is no longer on the server. It must not
  // be describing a push that has been taken back.
  it("claims nothing about a push that has been undone", () => {
    commit("README.md", "changed\n", "explain the readme");
    click(named(panel("git"), "Push"));
    click(named(document.body, "Undo"));
    expect(rows("server").length).toBe(0);
    expect(hint()).not.toContain("your commit");
    expect(hint().toLowerCase()).not.toContain("on the server");
    // The cancelled teammate must not arrive on a push that no longer happened.
    vi.advanceTimersByTime(2000);
    expect(rows("server").length).toBe(0);
  });

  it("never names a Pull the page would refuse to perform", () => {
    commit("README.md", "changed\n", "explain the readme");
    click(named(panel("git"), "Push"));
    // Nobody has pushed yet, so the instruction must not claim they have.
    expect(hint()).not.toContain("Pull");
    expect(pull().disabled).toBe(true);

    // Once they have, the instruction and the button agree.
    vi.advanceTimersByTime(2000);
    expect(hint()).toContain("refused");
    expect(hint()).toContain("Pull");
    expect(pull().disabled).toBe(false);

    click(named(panel("git"), "Push"));
    click(pull());
    expect(hint()).not.toContain("refused");
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

  // No gutter at this width, so the instruction is a bar across the top of the
  // screen rather than a column beside a panel - and the accent border on the
  // panel it names is what points, exactly as it does wide.
  it("lifts the walkthrough out to a bar above the picture", () => {
    const prompt = document.querySelector("[data-prompt]");
    expect(prompt?.parentElement?.classList.contains("screen")).toBe(true);
    expect(panel("files")?.getAttribute("data-hint")).toBe("true");
  });

  it("still says what the instruction is, and why", () => {
    expect(hint()).not.toBe("");
    expect(why()).not.toBe("");
  });

  // Every verb the wide page offers has to be reachable here too: a phone that
  // can only read the picture is not the same artefact.
  it("walks the core loop by click alone, exactly as the wide page does", () => {
    vi.useFakeTimers();
    commit("README.md", "changed\n", "explain the readme");
    click(named(panel("git"), "Push"));
    vi.advanceTimersByTime(2000);
    click(named(panel("git"), "Push"));
    expect(said()).toContain("Refused");
    click(named(panel("git"), "Pull"));
    commit("notes.md", "todo\n", "start the notes");
    click(named(panel("git"), "Merge origin/main into main"));
    const field = panel("index")?.querySelector<HTMLInputElement>(".message");
    type(field as HTMLInputElement, "merge bonnie");
    click(named(panel("index"), "Commit"));
    expect(named(panel("git"), "Branch")).toBeTruthy();
    vi.useRealTimers();
  });
});
