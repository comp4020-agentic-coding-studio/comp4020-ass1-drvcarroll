import { describe, expect, it } from "vitest";
import { commitIndex, edit, emptyWorld, stage } from "../src/git/repo.js";
import { branch, checkout } from "../src/git/branch.js";
import type { Ctx, Cursor, Step } from "../src/ui/stages.js";
import {
  RUNS,
  START,
  allowed,
  nextCursor,
  runAt,
  sayFor,
  stepAt,
  whyFor,
} from "../src/ui/stages.js";

// The walk is three runs, in order, repeating. What is defended here is that
// the structure holds and that every predicate is asked relative to where the
// step began - the one property that makes a second lap through the same three
// runs behave exactly like the first. Whether the instructions can actually be
// followed on the page is spec/page.test.ts's job; this is the layer beneath.

const ctx = (world: World, over?: Partial<Ctx>): Ctx => ({
  world,
  entry: world,
  runEntry: world,
  seen: new Set<string>(),
  ...over,
});

type World = ReturnType<typeof emptyWorld>;

const seeded = (): World => {
  let world = emptyWorld();
  world = edit(world, "README.md", "start\n");
  world = edit(world, "notes.md", "notes\n");
  return world;
};

const committed = (world: World, path: string, text: string): World =>
  commitIndex(stage(edit(world, path, text), path), `wrote ${path}`);

const steps = (): Step[] => RUNS.flatMap((r) => r.steps);

const stepIn = (run: string, id: string): Step => {
  const found = RUNS.find((r) => r.id === run)?.steps.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no step ${run}/${id}`);
  return found;
};

describe("the shape of the walk", () => {
  it("is exactly the three runs the brief asks for, in order", () => {
    expect(RUNS.map((r) => r.id)).toEqual(["share", "merge", "branch"]);
  });

  it("titles every run in words a beginner can read", () => {
    for (const run of RUNS) {
      expect(run.title).not.toBe("");
      expect(run.steps.length).toBeGreaterThan(0);
    }
  });

  it("gives every step a unique id within its run", () => {
    for (const run of RUNS) {
      const ids = run.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("points every step at an entity that exists", () => {
    const entities = new Set(["files", "index", "git", "server"]);
    for (const step of steps()) expect(entities.has(step.at)).toBe(true);
  });
});

// The whole point of the piece is that it explains. A step whose "why" is a
// label rather than a paragraph is a step that has told the visitor what to
// press and taught them nothing, so the length is asserted rather than trusted.
describe("every step explains, not just instructs", () => {
  const world = seeded();

  it("says what to do, in one short sentence", () => {
    for (const step of steps()) {
      const said = sayFor(step, ctx(world));
      expect(said.length).toBeGreaterThan(10);
      expect(said.length).toBeLessThan(120);
    }
  });

  // Both ends are pinned. Too short and the step has told the visitor what to
  // press and taught them nothing; too long and it overflows the gutter it is
  // drawn in at 1920 and the bar it is drawn in at 390. One tight claim each.
  it("explains why on every single step, in one tight claim", () => {
    for (const step of steps()) {
      const why = whyFor(step, ctx(world));
      expect(why.length, `${step.id} explains too little`).toBeGreaterThan(80);
      expect(why.length, `${step.id} will overflow`).toBeLessThan(150);
    }
  });

  it("explains more than it instructs, everywhere", () => {
    for (const step of steps()) {
      const c = ctx(world);
      expect(whyFor(step, c).length).toBeGreaterThan(sayFor(step, c).length);
    }
  });
});

describe("what a step unlocks", () => {
  it("hands the page exactly the step's own controls", () => {
    expect([...allowed(START)]).toEqual([...stepIn("share", "edit").allow]);
  });

  // A step that locks away part of its own path is a dead end, and a dead end
  // in a walk the visitor cannot leave is the worst failure this page has. The
  // patterns match the button labels the page actually draws, so an
  // instruction naming a button its own step has locked is caught here.
  it("unlocks every control its own instruction names", () => {
    const needs: [RegExp, string][] = [
      [/\bpress Save\b/i, "save"],
      [/\bpress Commit\b/i, "commit"],
      [/\bpress Push\b/i, "push"],
      [/\bpress Pull\b/i, "pull"],
      [/\bpress Merge\b/i, "merge"],
      [/\bpress Branch\b/i, "branch"],
      [/\bStart a branch here\b/i, "branch"],
      [/\bchip\b/i, "checkout"],
      [/\bclick \w+\.\w+\b/i, "files"], // "Click notes.md, ..."
      [/\btype .*into the editor\b/i, "files"],
    ];
    const world = branch(committed(seeded(), "README.md", "one\n"), "side");
    for (const step of steps()) {
      const said = sayFor(step, ctx(world));
      for (const [pattern, control] of needs) {
        if (!pattern.test(said)) continue;
        expect(
          [...step.allow].includes(control as never),
          `${step.id} says "${said}" but does not allow ${control}`,
        ).toBe(true);
      }
    }
  });

  it("locks everything while the one step that only waits is current", () => {
    expect([...stepIn("share", "arrives").allow]).toEqual([]);
  });
});

describe("the cursor walks the runs and then starts again", () => {
  it("begins at the first step of the first run", () => {
    expect(START).toEqual({ run: 0, step: 0 });
    expect(stepAt(START)?.id).toBe("edit");
    expect(runAt(START)?.id).toBe("share");
  });

  it("steps through a run, then into the next one", () => {
    let cursor: Cursor = START;
    const share = RUNS[0] as (typeof RUNS)[number];
    for (let i = 1; i < share.steps.length; i += 1) {
      cursor = nextCursor(cursor);
      expect(cursor).toEqual({ run: 0, step: i });
    }
    expect(nextCursor(cursor)).toEqual({ run: 1, step: 0 });
  });

  it("wraps past the last run back to the first, so the walk repeats", () => {
    const last = RUNS.length - 1;
    const end = { run: last, step: (RUNS[last]?.steps.length ?? 1) - 1 };
    expect(nextCursor(end)).toEqual(START);
  });

  it("visits every step exactly once per lap", () => {
    const total = RUNS.reduce((n, r) => n + r.steps.length, 0);
    const seen: string[] = [];
    let cursor: Cursor = START;
    for (let i = 0; i < total; i += 1) {
      seen.push(`${String(cursor.run)}:${String(cursor.step)}`);
      cursor = nextCursor(cursor);
    }
    expect(new Set(seen).size).toBe(total);
    expect(cursor).toEqual(START); // and lands back at the start
  });
});

// The property the second lap depends on. Every predicate asks "since this
// step began", never "does the world contain one of these" - so a repo with a
// dozen commits in it does not arrive at "make a commit" already satisfied.
describe("every predicate is asked relative to where the step began", () => {
  it("does not count a commit made before the step was reached", () => {
    const world = committed(committed(seeded(), "README.md", "one\n"), "notes.md", "two\n");
    const step = stepIn("share", "commit");
    expect(step.done(ctx(world))).toBe(false);
    const after = committed(world, "README.md", "three\n");
    expect(step.done(ctx(after, { entry: world }))).toBe(true);
  });

  it("does not count an edit made before the step was reached", () => {
    const world = edit(seeded(), "README.md", "already changed\n");
    const step = stepIn("share", "edit");
    expect(step.done(ctx(world))).toBe(false);
    const after = edit(world, "README.md", "changed again\n");
    expect(step.done(ctx(after, { entry: world }))).toBe(true);
  });

  it("does not count a staged file left over from a previous lap", () => {
    const world = stage(edit(seeded(), "README.md", "x\n"), "README.md");
    const step = stepIn("share", "save");
    expect(step.done(ctx(world))).toBe(false);
    const after = stage(edit(world, "notes.md", "y\n"), "notes.md");
    expect(step.done(ctx(after, { entry: world }))).toBe(true);
  });

  it("does not count a branch that already existed", () => {
    const world = branch(committed(seeded(), "README.md", "one\n"), "old");
    const step = stepIn("branch", "start");
    expect(step.done(ctx(world))).toBe(false);
    expect(step.done(ctx(branch(world, "new"), { entry: world }))).toBe(true);
  });

  it("does not count a merge commit from an earlier lap", () => {
    const base = committed(seeded(), "README.md", "one\n");
    const step = stepIn("merge", "seal");
    expect(step.done(ctx(base))).toBe(false);
  });
});

describe("the refusal a world cannot record", () => {
  it("is the only thing read out of the page's own memory", () => {
    const world = seeded();
    const step = stepIn("merge", "refused");
    expect(step.done(ctx(world))).toBe(false);
    expect(step.done(ctx(world, { seen: new Set(["push:refused"]) }))).toBe(true);
  });

  // The step unlocks Push and nothing else, so a push that succeeded here
  // would leave no control able to move the walk on. Every step has to have a
  // way out of it, whatever happened.
  it("also lets go if the push somehow succeeded, rather than trapping", () => {
    const before = committed(seeded(), "README.md", "one\n");
    const after = { ...before, remote: { ...before.local } };
    expect(stepIn("merge", "refused").done(ctx(after, { entry: before }))).toBe(
      true,
    );
  });
});

// No step may be a room with no door. Every one has to be completable by the
// controls it unlocks, and this is the blunt version of that claim: nothing
// declares an empty allow list except the one step that is explicitly a wait.
describe("no step is a dead end", () => {
  it("unlocks at least one control, or is the step that only waits", () => {
    for (const step of steps()) {
      if (step.id === "arrives") continue;
      expect(step.allow.length, `${step.id} unlocks nothing`).toBeGreaterThan(0);
    }
  });

  it("completes the waiting step on the world alone, with nothing pressed", () => {
    const step = stepIn("share", "arrives");
    expect(step.allow.length).toBe(0);
    // It is satisfied by the server moving, which is not the visitor's doing.
    const mine = committed(seeded(), "README.md", "one\n");
    expect(step.done(ctx(mine))).toBe(false);
  });
});

// Run three names the branch back to the visitor, and it has to be the one
// they made in this lap - not one left pinned to a commit from the lap before.
describe("run three names the branch the visitor just made", () => {
  it("picks the newest branch of this run, not one from a previous lap", () => {
    const base = branch(committed(seeded(), "README.md", "one\n"), "old");
    const now = branch(base, "fresh");
    const c = ctx(now, { runEntry: base, entry: base });
    expect(sayFor(stepIn("branch", "move"), c)).toContain("fresh");
    expect(sayFor(stepIn("branch", "move"), c)).not.toContain("old");
    expect(sayFor(stepIn("branch", "combine"), c)).toContain("fresh");
  });

  it("knows you are back on main only if you had left it", () => {
    const base = branch(committed(seeded(), "README.md", "one\n"), "side");
    const onSide = checkout(base, "side");
    const step = stepIn("branch", "back");
    // Still on side: not done.
    expect(step.done(ctx(onSide, { entry: onSide }))).toBe(false);
    // Back on main, having been on side: done.
    expect(step.done(ctx(checkout(onSide, "main"), { entry: onSide }))).toBe(true);
    // Never left main: not done, however clean the tree is.
    expect(step.done(ctx(base, { entry: base }))).toBe(false);
  });
});
