import { describe, expect, it } from "vitest";
import { canPush, fetch, push } from "../src/git/remote.js";
import { commitIndex, edit, emptyWorld, headOid, stage } from "../src/git/repo.js";

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
