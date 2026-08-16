import { describe, expect, it } from "vitest";
import { branch, checkout } from "../src/git/branch.js";
import { abortMerge, mergeBase, startMerge } from "../src/git/merge.js";
import { commitIndex, edit, emptyWorld, headOid, stage } from "../src/git/repo.js";
import { canPush, fetch, push, teammatePushes } from "../src/git/remote.js";
import { readCommit } from "../src/git/objects.js";

// A merge is the three-column comparison again: what you both agreed on, what
// you did, what they did. A conflict is the one case where that comparison has
// no answer, which is why it is a state rather than an error.

function seeded(): ReturnType<typeof emptyWorld> {
  let w = edit(emptyWorld(), "README.md", "shared\n");
  w = edit(w, "main.ts", "mine\n");
  return commitIndex(stage(stage(w, "README.md"), "main.ts"), "first");
}

// Two histories that both moved on from one commit.
function diverged(theirText = "theirs\n", path = "README.md") {
  const base = push(seeded());
  const theirs = teammatePushes(base, path, theirText, "their change");
  const mine = commitIndex(
    stage(edit(theirs, "main.ts", "mine, changed\n"), "main.ts"),
    "my change",
  );
  return fetch(mine);
}

describe("the commit you last agreed on", () => {
  it("is what both sides are measured against", () => {
    const world = diverged();
    const base = mergeBase(
      world.local.objects,
      headOid(world.local) as string,
      world.local.refs["origin/main"] as string,
    );
    expect(base).toBe(headOid(push(seeded()).local));
  });
});

describe("push is refused when the server moved without you", () => {
  it("says no, and changes nothing", () => {
    const world = diverged();
    expect(canPush(world)).toBe(false);
    expect(push(world)).toEqual(world);
  });

  it("is allowed again once their work is merged in and committed", () => {
    const merged = commitIndex(startMerge(diverged(), "origin/main"), "merge");
    expect(canPush(merged)).toBe(true);
  });
});

describe("a merge with two parents", () => {
  it("takes one change from each side when they touched different files", () => {
    const merged = startMerge(diverged(), "origin/main");
    expect(merged.merging?.conflicts).toEqual([]);
    expect(merged.working["README.md"]).toBe("theirs\n");
    expect(merged.working["main.ts"]).toBe("mine, changed\n");
  });

  it("seals into one commit naming both, using the verb already learned", () => {
    const world = startMerge(diverged(), "origin/main");
    const sealed = commitIndex(world, "merge");
    const c = readCommit(sealed.local.objects, headOid(sealed.local) as string);
    expect(c?.parents).toHaveLength(2);
    expect(sealed.merging).toBeUndefined();
  });
});

describe("a conflict is a state, not an error", () => {
  it("marks only the path both sides moved differently", () => {
    const both = commitIndex(
      stage(edit(diverged(), "README.md", "mine\n"), "README.md"),
      "mine too",
    );
    const merged = startMerge(both, "origin/main");
    expect(merged.merging?.conflicts).toEqual(["README.md"]);
  });

  it("writes both sides into the file, and leaves it unstaged", () => {
    const both = commitIndex(
      stage(edit(diverged(), "README.md", "mine\n"), "README.md"),
      "mine too",
    );
    const merged = startMerge(both, "origin/main");
    expect(merged.working["README.md"]).toContain("mine");
    expect(merged.working["README.md"]).toContain("theirs");
    // Unstaged on purpose: committing now would seal the markers.
    expect(merged.index["README.md"]).not.toBe(merged.working["README.md"]);
  });

  it("resolves with edit, stage and commit, and nothing else", () => {
    const both = commitIndex(
      stage(edit(diverged(), "README.md", "mine\n"), "README.md"),
      "mine too",
    );
    const merged = startMerge(both, "origin/main");
    const fixed = commitIndex(
      stage(edit(merged, "README.md", "both\n"), "README.md"),
      "resolved",
    );
    const c = readCommit(fixed.local.objects, headOid(fixed.local) as string);
    expect(c?.parents).toHaveLength(2);
    expect(fixed.working["README.md"]).toBe("both\n");
  });
});

describe("a file git has never seen", () => {
  it("survives a merge untouched", () => {
    const world = edit(diverged(), "scratch.txt", "notes to self\n");
    expect(startMerge(world, "origin/main").working["scratch.txt"]).toBe(
      "notes to self\n",
    );
  });
});

describe("abandoning a half-done merge", () => {
  it("puts the files back to what HEAD says and forgets the merge", () => {
    const before = diverged();
    const after = abortMerge(startMerge(before, "origin/main"));
    expect(after.merging).toBeUndefined();
    expect(after.working).toEqual(before.working);
  });

  it("does nothing at all when no merge is under way", () => {
    const world = diverged();
    expect(abortMerge(world)).toEqual(world);
  });
});

describe("a merge into a branch that never diverged", () => {
  it("is refused by startMerge, because it is a fast-forward instead", () => {
    const world = branch(seeded(), "feature");
    expect(startMerge(checkout(world, "main"), "feature")).toEqual(
      checkout(world, "main"),
    );
  });
});
