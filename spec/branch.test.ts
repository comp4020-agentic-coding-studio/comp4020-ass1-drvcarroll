import { describe, expect, it } from "vitest";
import {
  branch,
  canFastForward,
  checkout,
  merge,
  resetBack,
  resetTo,
} from "../src/git/branch.js";
import { commitIndex, edit, emptyWorld, headOid, stage } from "../src/git/repo.js";
import { statusFor } from "../src/git/status.js";

// A branch is a pointer. Every assertion in here is really the same one: no
// object is created, copied or destroyed by any of these verbs.

function committed(text = "one"): ReturnType<typeof emptyWorld> {
  return commitIndex(stage(edit(emptyWorld(), "a.txt", text), "a.txt"), "first");
}

const objectCount = (w: ReturnType<typeof emptyWorld>): number =>
  Object.keys(w.local.objects).length;

describe("starting a branch", () => {
  it("adds a name for a commit you already have, and nothing else", () => {
    const before = committed();
    const after = branch(before, "feature");
    expect(after.local.refs["feature"]).toBe(headOid(before.local));
    expect(objectCount(after)).toBe(objectCount(before));
  });

  it("refuses to take a name that is already in use", () => {
    const world = committed();
    expect(branch(world, "main")).toEqual(world);
  });

  it("has nothing to point at before the first commit", () => {
    const world = edit(emptyWorld(), "a.txt", "one");
    expect(branch(world, "feature")).toEqual(world);
  });
});

describe("checking out", () => {
  it("puts the files back to what that branch's commit says", () => {
    const first = committed();
    const onFeature = commitIndex(
      stage(
        edit(checkout(branch(first, "feature"), "feature"), "a.txt", "two"),
        "a.txt",
      ),
      "second",
    );
    const back = checkout(onFeature, "main");
    expect(back.working["a.txt"]).toBe("one");
    expect(statusFor(back, "a.txt").modified).toBe(false);
  });

  it("refuses on a dirty tree rather than throwing the work away", () => {
    const dirty = edit(branch(committed(), "feature"), "a.txt", "unsaved");
    expect(checkout(dirty, "feature")).toEqual(dirty);
  });
});

describe("fast-forward is not a merge at all", () => {
  it("slides the pointer forward when there is nothing to combine", () => {
    const first = committed();
    const ahead = commitIndex(
      stage(edit(checkout(branch(first, "feature"), "feature"), "a.txt", "two"), "a.txt"),
      "second",
    );
    const onMain = checkout(ahead, "main");
    expect(canFastForward(onMain, "feature")).toBe(true);

    const merged = merge(onMain, "feature");
    expect(merged.local.refs["main"]).toBe(merged.local.refs["feature"]);
    expect(merged.working["a.txt"]).toBe("two");
    expect(objectCount(merged)).toBe(objectCount(onMain));
  });

  it("says no when the other branch is not ahead", () => {
    const world = branch(committed(), "feature");
    expect(canFastForward(world, "feature")).toBe(false);
    expect(merge(world, "feature")).toEqual(world);
  });
});

describe("moving the branch back is how you undo a commit", () => {
  it("points at the parent and leaves the commit itself in .git", () => {
    const second = commitIndex(
      stage(edit(committed(), "a.txt", "two"), "a.txt"),
      "second",
    );
    const undone = resetBack(second);
    expect(headOid(undone.local)).toBe(headOid(committed().local));
    expect(objectCount(undone)).toBe(objectCount(second));
  });

  it("leaves the change staged, so committing again is the redo", () => {
    const second = commitIndex(
      stage(edit(committed(), "a.txt", "two"), "a.txt"),
      "second",
    );
    const undone = resetBack(second);
    expect(statusFor(undone, "a.txt").staged).toBe(true);
    expect(headOid(commitIndex(undone, "second").local)).toBe(
      headOid(second.local),
    );
  });

  it("removes the branch entirely when undoing the very first commit", () => {
    const undone = resetBack(committed());
    expect(headOid(undone.local)).toBeUndefined();
  });

  it("refuses mid-merge, so the merge's own state never goes stale", () => {
    const second = commitIndex(
      stage(edit(committed(), "a.txt", "two"), "a.txt"),
      "second",
    );
    const merging = {
      ...second,
      merging: { name: "feature", theirs: "0000000", conflicts: [] },
    };
    expect(resetBack(merging)).toEqual(merging);
  });
});

describe("pointing a branch at an old commit is also blocked mid-merge", () => {
  it("refuses, for the same reason resetBack does", () => {
    const world = committed();
    const merging = {
      ...world,
      merging: { name: "feature", theirs: "0000000", conflicts: [] },
    };
    expect(resetTo(merging, headOid(world.local) as string)).toEqual(merging);
  });
});
