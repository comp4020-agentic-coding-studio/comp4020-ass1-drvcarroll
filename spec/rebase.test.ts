import { describe, expect, it } from "vitest";
import { branch, checkout } from "../src/git/branch.js";
import { ancestry } from "../src/git/objects.js";
import { canRebase, rebase, unreachable } from "../src/git/rebase.js";
import { commitIndex, edit, emptyWorld, headOid, stage } from "../src/git/repo.js";

// Two lines from one commit: main gains theirs.txt, feature gains mine.txt.
// Replaying feature onto main is the whole subject of this suite.
function diverged(): ReturnType<typeof emptyWorld> {
  const seed = commitIndex(
    stage(edit(emptyWorld(), "README.md", "start\n"), "README.md"),
    "start",
  );
  const forked = branch(seed, "feature");
  const theirs = commitIndex(
    stage(edit(forked, "theirs.txt", "theirs\n"), "theirs.txt"),
    "theirs",
  );
  const back = checkout(theirs, "feature");
  return commitIndex(
    stage(edit(back, "mine.txt", "mine\n"), "mine.txt"),
    "mine",
  );
}

describe("when replaying applies at all", () => {
  it("refuses when the two lines have not diverged", () => {
    const world = branch(
      commitIndex(
        stage(edit(emptyWorld(), "README.md", "a\n"), "README.md"),
        "one",
      ),
      "feature",
    );
    expect(canRebase(world, "feature")).toBe(false);
    expect(rebase(world, "feature")).toEqual(world);
  });

  it("offers itself once they have", () => {
    expect(canRebase(diverged(), "main")).toBe(true);
  });
});

describe("replaying feature onto main", () => {
  it("leaves one line, with their commit underneath yours", () => {
    const world = rebase(diverged(), "main");
    const line = ancestry(world.local.objects, headOid(world.local) as string);
    expect(line.map((c) => c.message)).toEqual(["mine", "theirs", "start"]);
  });

  it("keeps both changes in your files", () => {
    const world = rebase(diverged(), "main");
    expect(Object.keys(world.working).sort()).toEqual([
      "README.md",
      "mine.txt",
      "theirs.txt",
    ]);
  });

  it("gives the same content a different hash, because the parent changed", () => {
    const before = diverged();
    const after = rebase(before, "main");
    expect(headOid(after.local)).not.toBe(headOid(before.local));
  });

  it("leaves the original commit in .git with nothing pointing at it", () => {
    const before = diverged();
    const was = headOid(before.local) as string;
    const after = rebase(before, "main");
    expect(after.local.objects[was]).toBeDefined();
    expect(unreachable(after)).toContain(was);
  });
});
