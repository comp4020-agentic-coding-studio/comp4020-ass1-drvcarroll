import { describe, expect, it } from "vitest";
import {
  commitIndex,
  discard,
  edit,
  emptyWorld,
  stage,
  unstage,
} from "../src/git/repo.js";
import { statusFor } from "../src/git/status.js";

// A visitor who cannot back out stops poking the model, so every verb ships
// with its reversal. What a reversal restores is the working tree and the
// index; the objects inside .git deliberately stay, and that retention is the
// reason unstaging is cheap enough to be worth teaching first.

describe("unstaging puts the world back", () => {
  it("empties the slot again, for a file git had never seen", () => {
    const before = edit(emptyWorld(), "a.txt", "hello");
    const after = unstage(stage(before, "a.txt"), "a.txt");
    expect(after.index).toEqual(before.index);
    expect(after.working).toEqual(before.working);
  });

  it("restores the committed version, not an empty slot", () => {
    const first = commitIndex(
      stage(edit(emptyWorld(), "a.txt", "one"), "a.txt"),
      "first",
    );
    const before = edit(first, "a.txt", "two");
    const after = unstage(stage(before, "a.txt"), "a.txt");
    expect(after.index).toEqual(before.index);
    expect(statusFor(after, "a.txt").modified).toBe(true);
  });

  it("loses nothing, because the blob is already inside .git", () => {
    const staged = stage(edit(emptyWorld(), "a.txt", "hello"), "a.txt");
    const after = unstage(staged, "a.txt");
    expect(after.local.objects).toEqual(staged.local.objects);
  });
});

describe("discarding is the one verb that really loses something", () => {
  it("throws away the edit and keeps the staged content", () => {
    const staged = stage(edit(emptyWorld(), "a.txt", "one"), "a.txt");
    const scribbled = edit(staged, "a.txt", "two");
    expect(discard(scribbled, "a.txt")).toEqual(staged);
  });

  it("removes a file git never knew about, and cannot get it back", () => {
    const world = discard(edit(emptyWorld(), "new.txt", "draft"), "new.txt");
    expect("new.txt" in world.working).toBe(false);
    expect(Object.values(world.local.objects)).toHaveLength(0);
  });
});
