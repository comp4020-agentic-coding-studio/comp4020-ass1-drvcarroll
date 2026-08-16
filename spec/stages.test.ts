import { describe, expect, it } from "vitest";
import {
  commitIndex,
  edit,
  emptyWorld,
  stage,
  unstage,
} from "../src/git/repo.js";
import { STAGES, record, suggestion } from "../src/ui/stages.js";

// Two claims are being defended here, and they are the difference between an
// explorable model and a tutorial: no stage can be met without a real change
// to the world, and no stage gates anything.

const start = (): ReturnType<typeof emptyWorld> =>
  edit(emptyWorld(), "a.txt", "one");

const met = (world: ReturnType<typeof emptyWorld>): ReadonlySet<string> =>
  record(new Set(), world, start());

describe("a stage is a fact about the world, not a count of clicks", () => {
  it("meets nothing at all on the world the visitor arrives to", () => {
    expect([...met(start())]).toEqual([]);
  });

  it("meets no stage that a look-but-touch-nothing visitor could reach", () => {
    // Opening entities is disclosure, not progress, so it never appears here:
    // the predicates cannot see the UI at all, only the World.
    for (const s of STAGES) expect(s.met(start(), start())).toBe(false);
  });

  it("records the edit only once the text actually differs", () => {
    expect([...met(edit(start(), "a.txt", "one"))]).toEqual([]);
    expect(met(edit(start(), "a.txt", "two")).has("edit")).toBe(true);
  });

  it("records staging, then the commit that seals it", () => {
    const staged = stage(edit(start(), "a.txt", "two"), "a.txt");
    expect(met(staged).has("stage")).toBe(true);
    expect(met(staged).has("commit")).toBe(false);
    expect(met(commitIndex(staged, "first")).has("commit")).toBe(true);
  });
});

describe("stages record, they never gate", () => {
  it("lets a later verb run before its stage is reached", () => {
    // Committing without ever having been told to. The model accepts it, and
    // both stages are marked met at once.
    const world = commitIndex(stage(start(), "a.txt"), "out of order");
    expect(met(world).has("stage")).toBe(true);
    expect(met(world).has("commit")).toBe(true);
  });

  it("skips the prompt ahead to whatever is still unexplored", () => {
    const world = commitIndex(stage(start(), "a.txt"), "out of order");
    expect(suggestion(met(world))).toBe(
      STAGES.find((s) => s.id === "edit")?.prompt,
    );
  });

  it("keeps a stage met after the evidence for it is undone", () => {
    const staged = stage(edit(start(), "a.txt", "two"), "a.txt");
    const after = unstage(staged, "a.txt");
    const seen = record(met(staged), after, start());
    expect(seen.has("stage")).toBe(true);
  });
});

describe("scaffolding fades", () => {
  it("retires the prompt once every stage has been met", () => {
    expect(suggestion(new Set(STAGES.map((s) => s.id)))).toBeUndefined();
  });

  it("suggests the first unmet concept, in curriculum order", () => {
    expect(suggestion(new Set(["edit"]))).toBe(
      STAGES.find((s) => s.id === "stage")?.prompt,
    );
  });
});
