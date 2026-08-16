import { describe, expect, it } from "vitest";
import { branch, checkout } from "../src/git/branch.js";
import { commitIndex, edit, emptyWorld, stage } from "../src/git/repo.js";
import { STASH, pop, stash } from "../src/git/stash.js";
import { isClean, status } from "../src/git/status.js";

// The wall the visitor hits is a checkout refused on a dirty tree. Stash is
// the way through it, and it is a commit like every other commit.

function dirty(): ReturnType<typeof emptyWorld> {
  const first = commitIndex(
    stage(edit(emptyWorld(), "README.md", "committed\n"), "README.md"),
    "first",
  );
  return edit(branch(first, "feature"), "README.md", "half done\n");
}

describe("the wall", () => {
  it("refuses a checkout while there is work in the way", () => {
    const world = dirty();
    expect(checkout(world, "feature")).toEqual(world);
  });

  it("lets the same checkout through once the work is stashed", () => {
    const world = checkout(stash(dirty()), "feature");
    expect(world.local.head).toEqual({ kind: "branch", name: "feature" });
  });
});

describe("a stash is a commit off to the side", () => {
  it("is a name pointing at a commit, like everything else in .git", () => {
    const world = stash(dirty());
    const at = world.local.refs[STASH] as string;
    expect(world.local.objects[at]?.kind).toBe("commit");
  });

  it("hands back a clean tree", () => {
    expect(status(stash(dirty())).every(isClean)).toBe(true);
  });

  it("does nothing when there is nothing to put away", () => {
    const clean = stash(dirty());
    expect(stash(clean)).toEqual(clean);
  });
});

describe("getting the work back", () => {
  it("restores exactly the files that were put away", () => {
    const before = dirty();
    expect(pop(stash(before)).working).toEqual(before.working);
  });

  it("drops the name, and leaves the commit in .git", () => {
    const world = pop(stash(dirty()));
    expect(world.local.refs[STASH]).toBeUndefined();
    expect(Object.values(world.local.objects).some((o) => o.kind === "commit"))
      .toBe(true);
  });

  it("does nothing when nothing is held", () => {
    const world = dirty();
    expect(pop(world)).toEqual(world);
  });

  it("refuses over a dirty tree rather than overwriting it", () => {
    const stashed = stash(dirty());
    const dirtyAgain = edit(stashed, "README.md", "second half done\n");
    expect(pop(dirtyAgain)).toEqual(dirtyAgain);
  });

  it("leaves an untracked file alone", () => {
    const stashed = edit(stash(dirty()), "scratch.txt", "notes\n");
    expect(pop(stashed).working["scratch.txt"]).toBe("notes\n");
  });
});
