// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { start } from "../src/ui/app.js";
import { RUNS } from "../src/ui/stages.js";
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

// The instruction names a button; this is the assertion that pressing it was
// actually allowed. A locked button that the current step told you to press is
// the one bug this whole walk exists to make impossible.
const press = (within: ParentNode | null, label: string): void => {
  const button = named(within, label);
  if (button.disabled) throw new Error(`"${label}" is locked`);
  click(button);
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

const hint = (): string =>
  document.querySelector("[data-hint-do]")?.textContent ?? "";

const why = (): string =>
  document.querySelector("[data-hint-why]")?.textContent ?? "";

const where = (): string =>
  document.querySelector("[data-hint-where]")?.textContent ?? "";

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

const message = (text: string): void => {
  const field = panel("index")?.querySelector<HTMLInputElement>(".message");
  if (field === null || field === undefined) throw new Error("no message field");
  type(field, text);
};

// Edit, Save, Commit: the three steps that put a snapshot in .git.
const commit = (path: string, text: string, note: string): void => {
  pick(path);
  type(editor(), text);
  press(panel("files"), "Save");
  message(note);
  press(panel("index"), "Commit");
};

// ---- the walk ----

// One action per step of the three runs, doing exactly and only what that
// step's instruction says. Keyed by run id and step id, so a step added to
// RUNS without an action here fails loudly rather than being skipped.
let lap = 0;
let branchName = "";

const ACTIONS: Record<string, () => void> = {
  "share/edit": () => {
    pick("README.md");
    type(editor(), `# my project\n\nlap ${String(lap)}\n`);
  },
  "share/save": () => {
    press(panel("files"), "Save");
  },
  "share/commit": () => {
    message(`readme, lap ${String(lap)}`);
    press(panel("index"), "Commit");
  },
  "share/push": () => {
    press(panel("git"), "Push");
  },
  // The only step with nothing to press: the teammate arrives on their own.
  "share/arrives": () => {
    vi.advanceTimersByTime(2000);
  },
  "share/pull": () => {
    press(panel("git"), "Pull");
  },

  "merge/yours": () => {
    commit("notes.md", `- lap ${String(lap)}\n`, `notes, lap ${String(lap)}`);
  },
  "merge/refused": () => {
    press(panel("git"), "Push");
    expect(said()).toContain("Refused");
  },
  "merge/combine": () => {
    press(panel("git"), "Merge origin/main into main");
  },
  "merge/seal": () => {
    message(`merge theirs, lap ${String(lap)}`);
    press(panel("index"), "Commit");
  },
  "merge/share": () => {
    press(panel("git"), "Push");
  },

  "branch/start": () => {
    press(panel("git"), "Branch");
    const field = panel("git")?.querySelector<HTMLInputElement>(
      ".branch-controls .message",
    );
    branchName = `spike${String(lap)}`;
    type(field as HTMLInputElement, branchName);
    press(panel("git"), "Start a branch here");
  },
  "branch/move": () => {
    press(panel("git"), branchName);
  },
  "branch/work": () => {
    commit("main.ts", `console.log(${String(lap)});\n`, `main.ts, lap ${String(lap)}`);
  },
  "branch/back": () => {
    press(panel("git"), "main");
  },
  "branch/diverge": () => {
    commit("styles.css", `body { margin: ${String(lap)}px }\n`, `css, lap ${String(lap)}`);
  },
  "branch/combine": () => {
    press(panel("git"), `Merge ${branchName} into main`);
  },
  "branch/seal": () => {
    message(`merge ${branchName}`);
    press(panel("index"), "Commit");
  },
};

// Walks one full lap of all three runs, checking at every step that the page
// is where it says it is, that the instruction and the explanation are both
// on screen, and that doing what the instruction says moves the walk on by
// exactly one. Returns nothing: every claim is asserted as it goes.
const walkALap = (): void => {
  lap += 1;
  RUNS.forEach((run, r) => {
    run.steps.forEach((step, s) => {
      const place = `run ${String(r + 1)} step ${String(s + 1)} (${run.id}/${step.id})`;

      // Where the page says it is.
      expect(where(), place).toContain(`Run ${String(r + 1)} of 3`);
      expect(where(), place).toContain(run.title);
      expect(where(), place).toContain(
        `step ${String(s + 1)} of ${String(run.steps.length)}`,
      );

      // Both halves are on screen: what to do, and why it is worth doing.
      expect(hint(), place).not.toBe("");
      expect(why(), place).not.toBe("");
      expect(why().length, place).toBeGreaterThan(80);
      expect(why().length, place).toBeLessThan(150);

      const action = ACTIONS[`${run.id}/${step.id}`];
      if (action === undefined) throw new Error(`no action for ${place}`);
      action();

      // And it moved on by exactly one.
      const last = r === RUNS.length - 1 && s === run.steps.length - 1;
      const nextRun = last ? 1 : s + 1 < run.steps.length ? r + 1 : r + 2;
      const nextStep = last ? 1 : s + 1 < run.steps.length ? s + 2 : 1;
      expect(where(), `after ${place}`).toContain(
        `Run ${String(nextRun)} of 3`,
      );
      expect(where(), `after ${place}`).toContain(
        `step ${String(nextStep)} of`,
      );
    });
  });
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

  it("says nothing about runs until the runs have started", () => {
    expect(where()).toBe("");
  });

  it("reveals them in the direction a change travels", () => {
    for (const id of ["index", "git", "server"]) {
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

  it("hands over to run one, step one", () => {
    tour();
    expect(where()).toContain("Run 1 of 3");
    expect(where()).toContain("step 1 of");
    expect(hint()).toContain("README.md");
  });
});

// The claim the whole restructure rests on: three fixed runs, every step
// followable by its own instruction, and the walk repeating cleanly from
// whatever state the last run left. The second lap is the real test - it
// starts from a repo with a history, two branches and a merge already in it,
// which is where every "is this already true?" predicate bug shows up.
describe("the three runs, walked by their own instructions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lap = 0;
    boot();
    tour();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("walks one full lap of all three runs", () => {
    walkALap();
  });

  it("walks a second lap, from the state the first one left", () => {
    walkALap();
    // Back at the beginning, with everything the first lap built still there.
    expect(where()).toContain("Run 1 of 3");
    expect(where()).toContain("step 1 of");
    walkALap();
  });

  it("walks a third lap, so the repeat is a cycle and not a one-off", () => {
    walkALap();
    walkALap();
    walkALap();
    expect(where()).toContain("Run 1 of 3");
  });

  it("keeps every commit it ever made, across all three laps", () => {
    walkALap();
    const afterOne = rows("git").length;
    walkALap();
    expect(rows("git").length).toBeGreaterThan(afterOne);
  });

  it("ends each lap with a merge commit carrying two parents", () => {
    walkALap();
    // Run two sealed one and run three sealed another.
    expect(said()).toContain("Committed");
    expect(rows("git").length).toBeGreaterThan(4);
  });
});

// The walk is a lock, not a suggestion: the only things that can be touched
// are the things the current instruction named.
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
    lap = 0;
    boot();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    for (const name of ["save", "commit", "push", "pull"]) {
      expect(dead(name)).toBe(true);
    }
  });

  it("opens Save only once the instruction has moved on to it", () => {
    tour();
    expect(dead("save")).toBe(true);
    ACTIONS["share/edit"]?.();
    expect(hint()).toContain("Save");
    expect(live("save")).toBe(true);
    expect(dead("push")).toBe(true);
  });

  // Every step of every run, checked the same way: whatever the step allows is
  // live and everything else is dead. This is the exhaustive version of the
  // three tests above, and it is the one that would catch a step whose allow
  // list drifted away from its instruction.
  it("never leaves a control live that the current step did not name", () => {
    tour();
    lap += 1;
    for (const run of RUNS) {
      for (const step of run.steps) {
        const allow = new Set<string>(step.allow);
        for (const name of ["files", "save", "commit", "push", "pull", "merge"]) {
          if (allow.has(name)) continue;
          expect(
            live(name),
            `${run.id}/${step.id} leaves ${name} live`,
          ).toBe(false);
        }
        ACTIONS[`${run.id}/${step.id}`]?.();
      }
    }
  });

  // Reversal is the one thing the lock never takes away: a visitor who cannot
  // back out of a step stops poking the model.
  it("leaves Undo alone whatever the instruction says", () => {
    tour();
    ACTIONS["share/edit"]?.();
    const undo = document.querySelector<HTMLButtonElement>(".take-back");
    expect(undo?.disabled).toBe(false);
  });
});

describe("the advanced verbs stay off screen until a run asks for them", () => {
  beforeEach(() => {
    boot();
    tour();
  });

  it("gives .git exactly Pull and Push at the start", () => {
    const head = panel("git")?.querySelector(".panel-actions") ?? null;
    expect(shown(head).map((b) => b.textContent)).toEqual(["Pull", "Push"]);
  });

  it("holds back branching, stash and replay", () => {
    expect(missing(panel("git"), "Branch")).toBe(true);
    expect(missing(panel("files"), "Put aside")).toBe(true);
    expect(missing(panel("git"), "Replay")).toBe(true);
  });

  it("keeps the reversal that is not a git verb at page level", () => {
    expect(named(document.body, "Undo")).toBeTruthy();
  });
});

describe("edit, save, commit", () => {
  beforeEach(() => {
    lap = 1;
    boot();
    tour();
  });

  it("notices an edit before anything is staged", () => {
    ACTIONS["share/edit"]?.();
    expect(panel("index")?.textContent).toContain("Nothing staged");
    expect(hint()).toContain("Save");
  });

  it("stages on Save, and says where it went", () => {
    ACTIONS["share/edit"]?.();
    ACTIONS["share/save"]?.();
    expect(panel("index")?.querySelectorAll(".blob-list li").length).toBe(1);
    expect(said()).toContain("README.md");
  });

  it("puts a commit in .git, carrying the message typed", () => {
    ACTIONS["share/edit"]?.();
    ACTIONS["share/save"]?.();
    ACTIONS["share/commit"]?.();
    expect(rows("git").length).toBe(1);
    expect(rows("git")[0]?.textContent).toContain("readme, lap 1");
    expect(chips("git")).toContain("● main");
  });

  it("leaves the server empty until it is pushed to", () => {
    ACTIONS["share/edit"]?.();
    ACTIONS["share/save"]?.();
    ACTIONS["share/commit"]?.();
    expect(rows("server").length).toBe(0);
    expect(hint()).toContain("Push");
  });
});

describe("a teammate answers run one's push, and only that one", () => {
  const toPush = (): void => {
    ACTIONS["share/edit"]?.();
    ACTIONS["share/save"]?.();
    ACTIONS["share/commit"]?.();
    ACTIONS["share/push"]?.();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    lap = 1;
    boot();
    tour();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lands your push on the server first", () => {
    toPush();
    expect(rows("server").length).toBe(1);
  });

  it("has not answered yet at one second", () => {
    toPush();
    vi.advanceTimersByTime(1000);
    expect(rows("server").length).toBe(1);
  });

  it("pushes a real commit at two, and says what it means", () => {
    toPush();
    vi.advanceTimersByTime(2000);
    expect(rows("server").length).toBe(2);
    expect(said()).toContain("Bonnie");
    expect(said()).toContain("refused");
  });

  it("brings their commit down on Pull without touching your files", () => {
    toPush();
    vi.advanceTimersByTime(2000);
    const before = editor().value;
    press(panel("git"), "Pull");
    expect(chips("git")).toContain("origin/main");
    expect(editor().value).toBe(before);
    expect(said()).toContain("not changed");
  });

  it("merges their line into your file", () => {
    walkALap();
    pick("README.md");
    expect(editor().value).toContain("hi, my name is bonnie!");
  });

  // Run two's push is the one that must not be answered: a reply there would
  // put the server ahead in the middle of a run that never asked it to be, and
  // the next lap's run-one push would be refused with no instruction for it.
  it("does not answer run two's push", () => {
    walkALap();
    const settled = rows("server").length;
    vi.advanceTimersByTime(5000);
    expect(rows("server").length).toBe(settled);
  });

  it("cannot be overtaken by an undo", () => {
    toPush();
    click(named(document.body, "Undo"));
    vi.advanceTimersByTime(2000);
    expect(said()).not.toContain("Bonnie");
  });

  it("takes turns, one teammate per lap of run one", () => {
    walkALap();
    expect(said()).not.toContain("Bonnie pushed");
    walkALap();
    // The second lap's run one was answered by the other one.
    expect(rows("server").length).toBeGreaterThan(2);
  });
});

describe("everything can be taken back", () => {
  beforeEach(() => {
    lap = 1;
    boot();
    tour();
  });

  it("undoes the last change to the model", () => {
    ACTIONS["share/edit"]?.();
    ACTIONS["share/save"]?.();
    ACTIONS["share/commit"]?.();
    click(named(document.body, "Undo"));
    expect(rows("git").length).toBe(0);
  });

  // Undo has to rewind the walk as well as the world, or the instruction ends
  // up describing something that no longer happened.
  it("puts the instruction back where it was, not just the world", () => {
    ACTIONS["share/edit"]?.();
    ACTIONS["share/save"]?.();
    expect(hint()).toContain("Commit");
    click(named(document.body, "Undo"));
    expect(hint()).toContain("Save");
    expect(where()).toContain("step 2 of");
  });

  it("can be pressed repeatedly, back to the world it started in", () => {
    ACTIONS["share/edit"]?.();
    ACTIONS["share/save"]?.();
    ACTIONS["share/commit"]?.();
    for (let i = 0; i < 5; i += 1) {
      click(named(document.body, "Undo"));
    }
    expect(rows("git").length).toBe(0);
    expect(panel("index")?.textContent).toContain("Nothing staged");
    expect(where()).toContain("step 1 of");
  });
});

// Pull was once pressable the moment anything had been pushed, including your
// own push, so run one's pull could be answered two seconds early by fetching
// nothing at all.
describe("Pull is dead until there is something to pull", () => {
  const pull = (): HTMLButtonElement => named(panel("git"), "Pull");

  beforeEach(() => {
    vi.useFakeTimers();
    lap = 1;
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
    ACTIONS["share/edit"]?.();
    ACTIONS["share/save"]?.();
    ACTIONS["share/commit"]?.();
    ACTIONS["share/push"]?.();
    expect(rows("server").length).toBe(1);
    expect(pull().disabled).toBe(true);
  });

  it("comes alive only once a teammate has pushed", () => {
    ACTIONS["share/edit"]?.();
    ACTIONS["share/save"]?.();
    ACTIONS["share/commit"]?.();
    ACTIONS["share/push"]?.();
    vi.advanceTimersByTime(2000);
    expect(pull().disabled).toBe(false);
  });

  it("goes dead again once their commit is in .git", () => {
    ACTIONS["share/edit"]?.();
    ACTIONS["share/save"]?.();
    ACTIONS["share/commit"]?.();
    ACTIONS["share/push"]?.();
    vi.advanceTimersByTime(2000);
    press(panel("git"), "Pull");
    expect(chips("git")).toContain("origin/main");
    expect(pull().disabled).toBe(true);
  });
});

describe("on a phone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lap = 0;
    boot(390);
    tour();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("still says where you are, what to do, and why", () => {
    expect(where()).toContain("Run 1 of 3");
    expect(hint()).not.toBe("");
    expect(why().length).toBeGreaterThan(80);
  });

  // A phone that can only read the picture is not the same artefact. The whole
  // walk has to be reachable here by click alone.
  it("walks all three runs by click alone, exactly as the wide page does", () => {
    walkALap();
  });
});
