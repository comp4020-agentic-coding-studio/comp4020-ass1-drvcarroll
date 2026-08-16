import { describe, expect, it } from "vitest";
import { blob } from "../src/git/objects.js";
import {
  commitIndex,
  discard,
  edit,
  emptyWorld,
  headEntries,
  headOid,
  remove,
  stage,
  unstage,
} from "../src/git/repo.js";
import { glyphFor, isClean, status, statusFor } from "../src/git/status.js";

// The first three verbs, and the claim underneath all of them: nothing is lost
// on your own machine. Every test here is a sentence the explainer says without
// words, so a failure means the picture would be telling the visitor a lie.

const withReadme = (text: string): ReturnType<typeof emptyWorld> =>
  edit(emptyWorld(), "README.md", text);

describe("editing a file", () => {
  it("changes only the working tree", () => {
    const world = withReadme("# my project\n");
    expect(world.working["README.md"]).toBe("# my project\n");
    expect(world.index).toEqual({});
    expect(world.local.objects).toEqual({});
  });

  it("shows an untracked file as new", () => {
    expect(glyphFor(statusFor(withReadme("hi"), "README.md"))).toBe("A");
  });
});

describe("staging", () => {
  const staged = stage(withReadme("hi"), "README.md");

  it("puts a name in the index, not a copy", () => {
    expect(staged.index["README.md"]).toBe(blob("hi").oid);
  });

  it("writes the blob into .git immediately, as git does", () => {
    expect(staged.local.objects[blob("hi").oid]?.kind).toBe("blob");
  });

  it("does nothing to a path that is not in the working tree", () => {
    const world = emptyWorld();
    expect(stage(world, "nope.txt")).toBe(world);
  });

  it("reports the file as staged and not modified", () => {
    const found = statusFor(staged, "README.md");
    expect([found.staged, found.modified]).toEqual([true, false]);
  });

  it("reports modified again once the file changes underneath it", () => {
    const after = edit(staged, "README.md", "hi again");
    expect(glyphFor(statusFor(after, "README.md"))).toBe("M");
  });
});

describe("unstaging gives the index back, and loses nothing", () => {
  const staged = stage(withReadme("hi"), "README.md");

  it("empties the index for a file HEAD never had", () => {
    expect(unstage(staged, "README.md").index).toEqual({});
  });

  it("leaves the blob in .git", () => {
    const kept = unstage(staged, "README.md").local.objects[blob("hi").oid];
    expect(kept).toBeDefined();
  });

  it("restores what HEAD said for a file that was committed before", () => {
    const first = commitIndex(staged, "first");
    const second = stage(edit(first, "README.md", "changed"), "README.md");
    expect(unstage(second, "README.md").index["README.md"]).toBe(
      blob("hi").oid,
    );
  });
});

describe("discarding is the one lossy verb", () => {
  it("puts the staged content back over the working file", () => {
    const staged = stage(withReadme("hi"), "README.md");
    const edited = edit(staged, "README.md", "a mistake");
    expect(discard(edited, "README.md").working["README.md"]).toBe("hi");
  });

  it("deletes a file git never saw: there is nothing to restore", () => {
    const world = withReadme("never staged");
    expect(discard(world, "README.md").working).toEqual({});
  });
});

describe("committing", () => {
  const first = commitIndex(stage(withReadme("hi"), "README.md"), "first");

  it("moves the branch HEAD is on", () => {
    expect(first.local.refs["main"]).toBe(headOid(first.local));
  });

  it("snapshots exactly what the index held", () => {
    expect(headEntries(first.local)).toEqual({ "README.md": blob("hi").oid });
  });

  it("leaves the file clean", () => {
    expect(isClean(statusFor(first, "README.md"))).toBe(true);
  });

  it("chains the second commit onto the first", () => {
    const next = commitIndex(
      stage(edit(first, "README.md", "hi again"), "README.md"),
      "second",
    );
    const sealed = next.local.objects[headOid(next.local) ?? ""];
    expect(sealed?.kind === "commit" && sealed.parents).toEqual([
      headOid(first.local),
    ]);
  });

  it("reuses a blob it already has rather than storing it twice", () => {
    const before = Object.keys(first.local.objects).length;
    const again = stage(edit(first, "copy.md", "hi"), "copy.md");
    expect(Object.keys(again.local.objects)).toHaveLength(before);
  });

  it("leaves a detached HEAD pointing at the new commit", () => {
    const at = headOid(first.local) ?? "";
    const detached = {
      ...first,
      local: { ...first.local, head: { kind: "detached" as const, oid: at } },
    };
    const next = commitIndex(
      stage(edit(detached, "b.md", "b"), "b.md"),
      "on a detached head",
    );
    expect(next.local.head).toEqual({
      kind: "detached",
      oid: headOid(next.local),
    });
    expect(next.local.refs).toEqual(first.local.refs);
  });
});

describe("status is derived from three columns", () => {
  it("says nothing at all about an empty world", () => {
    expect(status(emptyWorld())).toEqual([]);
  });

  it("lists every path any column knows about, sorted", () => {
    const world = stage(edit(withReadme("a"), "b.md", "b"), "README.md");
    expect(status(world).map((s) => s.path)).toEqual(["README.md", "b.md"]);
  });

  it("still lists a tracked file that has been deleted", () => {
    const first = commitIndex(stage(withReadme("hi"), "README.md"), "first");
    const gone = statusFor(remove(first, "README.md"), "README.md");
    expect(glyphFor(gone)).toBe("D");
  });
});
