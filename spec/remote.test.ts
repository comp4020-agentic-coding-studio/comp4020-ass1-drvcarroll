import { describe, expect, it } from "vitest";
import { canPush, fetch, push, teammatePushes } from "../src/git/remote.js";
import { commitIndex, edit, emptyWorld, headOid, stage } from "../src/git/repo.js";
import { startMerge } from "../src/git/merge.js";
import { unreachable } from "../src/git/rebase.js";

// The gap. Everything else in the explainer happens on one machine, so these
// are the only two functions that read one repo and write the other.

function committed(text = "one", message = "first"): ReturnType<typeof emptyWorld> {
  return commitIndex(stage(edit(emptyWorld(), "a.txt", text), "a.txt"), message);
}

describe("pushing sends objects, it does not upload files", () => {
  it("leaves the server holding the same commit, by the same id", () => {
    const world = push(committed());
    expect(headOid(world.remote)).toBe(headOid(world.local));
  });

  it("sends the tree and the blob the commit names, not the working file", () => {
    const world = push(committed());
    const kinds = Object.values(world.remote.objects).map((o) => o.kind).sort();
    expect(kinds).toEqual(["blob", "commit", "tree"]);
    expect(world.remote).not.toHaveProperty("working");
  });

  it("changes nothing on your machine", () => {
    const before = committed();
    expect(push(before).local).toEqual(before.local);
  });

  it("has nothing to do when the server is already up to date", () => {
    const world = push(committed());
    expect(canPush(world)).toBe(false);
    expect(push(world)).toEqual(world);
  });

  it("is refused when the server holds work you do not have", () => {
    const theirs = push(committed("theirs", "collaborator"));
    // Same branch name, a commit that is not in your history.
    const mine = { ...committed("mine", "mine"), remote: theirs.remote };
    expect(canPush(mine)).toBe(false);
    expect(push(mine)).toEqual(mine);
  });
});

describe("fetching brings objects across without touching your files", () => {
  it("records where the server's branch is, under origin/", () => {
    const theirs = push(committed("theirs"));
    const mine = { ...emptyWorld(), remote: theirs.remote };
    const after = fetch(mine);
    expect(after.local.refs["origin/main"]).toBe(headOid(theirs.remote));
  });

  it("leaves the working tree exactly as it was", () => {
    const theirs = push(committed("theirs"));
    const mine = { ...edit(emptyWorld(), "b.txt", "mine"), remote: theirs.remote };
    const after = fetch(mine);
    expect(after.working).toEqual(mine.working);
    expect(after.index).toEqual(mine.index);
  });

  it("does nothing at all against an empty server", () => {
    const world = edit(emptyWorld(), "a.txt", "one");
    expect(fetch(world)).toEqual(world);
  });
});

// The whole collaboration loop, exactly as the UI drives it: push, someone
// else pushes, you diverge, you fetch and merge, and then you can push again.
// A regression here is a regression in "Push" reading as broken to a visitor.
describe("the full loop: push, diverge, fetch, merge, push again", () => {
  it("is refused after a teammate pushes, until you fetch and merge", () => {
    let world = committed();
    world = push(world);
    world = teammatePushes(world, "gary.txt", "hi", "gary's commit");
    expect(canPush(world)).toBe(false);

    world = fetch(world);
    expect(world.local.refs["origin/main"]).toBe(headOid(world.remote));
    expect(canPush(world)).toBe(false); // fetch alone never unblocks a push

    const merged = startMerge(world, "origin/main");
    expect(merged.merging?.conflicts).toEqual([]);
    world = commitIndex(merged, "merge gary's work");
    expect(canPush(world)).toBe(true);

    world = push(world);
    expect(headOid(world.remote)).toBe(headOid(world.local));
  });

  it("can push again after a fast-forward merge, once there is new local work", () => {
    let world = committed();
    world = push(world);
    world = teammatePushes(world, "gary.txt", "hi", "gary's commit");
    world = fetch(world);

    // Fast-forward: no local commits of your own since the last push, so
    // taking origin/main's commit is just moving the pointer, not a merge.
    world = { ...world, local: { ...world.local, refs: { ...world.local.refs, main: world.local.refs["origin/main"] as string } } };
    expect(canPush(world)).toBe(false); // level with the server, nothing to send

    world = commitIndex(stage(edit(world, "b.txt", "more"), "b.txt"), "more work");
    expect(canPush(world)).toBe(true);
  });

  it("the merge commit has two parents, and both are reachable, not ghosted", () => {
    let world = committed();
    world = push(world);
    world = teammatePushes(world, "gary.txt", "hi", "gary's commit");
    world = fetch(world);
    const theirs = world.local.refs["origin/main"] as string;
    world = commitIndex(startMerge(world, "origin/main"), "merge");
    const mergeCommit = world.local.objects[headOid(world.local) as string];
    expect(mergeCommit?.kind).toBe("commit");
    if (mergeCommit?.kind === "commit") {
      expect(mergeCommit.parents).toHaveLength(2);
      expect(mergeCommit.parents).toContain(theirs);
    }
    // Gary's fetched commit is reachable via origin/main and the merge
    // commit's own parent list - it must never be reported as unreachable.
    expect(unreachable(world)).not.toContain(theirs);
  });
});
