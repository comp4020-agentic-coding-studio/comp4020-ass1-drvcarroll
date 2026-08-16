import { describe, expect, it } from "vitest";
import {
  ancestry,
  blob,
  commit,
  put,
  readBlob,
  readCommit,
  tree,
} from "../src/git/objects.js";

// Three claims the drawing later makes without words: identical content is one
// object, a snapshot's name does not depend on how it was built, and a commit's
// name includes its parents. If any of these is false the explainer lies.

describe("blobs are content, named by content", () => {
  it("gives identical text the same name", () => {
    expect(blob("hello\n").oid).toBe(blob("hello\n").oid);
  });

  it("gives different text a different name", () => {
    expect(blob("hello\n").oid).not.toBe(blob("hello!\n").oid);
  });

  it("stores one entry when the same content is written twice", () => {
    const store = put({}, blob("same"), blob("same"));
    expect(Object.keys(store)).toHaveLength(1);
  });

  it("reads back the text it was given", () => {
    const object = blob("# my project\n");
    expect(readBlob(put({}, object), object.oid)?.text).toBe("# my project\n");
  });

  it("refuses to read a blob as a commit", () => {
    const object = blob("not a commit");
    expect(readCommit(put({}, object), object.oid)).toBeUndefined();
  });
});

describe("trees name a snapshot, not an order", () => {
  it("hashes the same whichever order the entries arrived in", () => {
    const a = blob("a").oid;
    const b = blob("b").oid;
    expect(tree({ "a.txt": a, "b.txt": b }).oid).toBe(
      tree({ "b.txt": b, "a.txt": a }).oid,
    );
  });

  it("changes name when a file's content changes", () => {
    const before = tree({ "a.txt": blob("one").oid });
    const after = tree({ "a.txt": blob("two").oid });
    expect(before.oid).not.toBe(after.oid);
  });

  it("changes name when a file is added", () => {
    const a = blob("a").oid;
    expect(tree({ "a.txt": a }).oid).not.toBe(
      tree({ "a.txt": a, "b.txt": a }).oid,
    );
  });

  it("shares one blob between two paths with the same content", () => {
    const shared = blob("copy me");
    const snapshot = tree({ "a.txt": shared.oid, "b.txt": shared.oid });
    expect(Object.keys(put({}, shared, snapshot))).toHaveLength(2);
  });
});

describe("commits carry their parents into their name", () => {
  const snapshot = tree({ "a.txt": blob("a").oid }).oid;

  it("names the same tree, parent and message identically", () => {
    const spec = { tree: snapshot, parents: [], message: "first" };
    expect(commit(spec).oid).toBe(commit(spec).oid);
  });

  it("gets a new name when only the parent changes", () => {
    const onto = (parent: string): string =>
      commit({ tree: snapshot, parents: [parent], message: "same" }).oid;
    expect(
      onto("1111111"),
      "Identical content replayed onto a different parent is a different " +
        "commit. This is rebase, and it has to fall out of the model.",
    ).not.toBe(onto("2222222"));
  });

  it("gets a new name when only the message changes", () => {
    const of = (message: string): string =>
      commit({ tree: snapshot, parents: [], message }).oid;
    expect(of("first")).not.toBe(of("second"));
  });

  it("keeps both parents of a merge", () => {
    const merge = commit({
      tree: snapshot,
      parents: ["1111111", "2222222"],
      message: "merge",
    });
    expect(merge.parents).toEqual(["1111111", "2222222"]);
  });
});

describe("walking back from a commit", () => {
  const snapshot = tree({ "a.txt": blob("a").oid }).oid;
  const root = commit({ tree: snapshot, parents: [], message: "root" });
  const mid = commit({ tree: snapshot, parents: [root.oid], message: "mid" });
  const side = commit({ tree: snapshot, parents: [root.oid], message: "side" });
  const merge = commit({
    tree: snapshot,
    parents: [mid.oid, side.oid],
    message: "merge",
  });
  const store = put({}, root, mid, side, merge);

  it("returns the commit itself first", () => {
    expect(ancestry(store, merge.oid)[0]?.oid).toBe(merge.oid);
  });

  it("visits a shared ancestor once, not once per path", () => {
    const oids = ancestry(store, merge.oid).map((c) => c.oid);
    expect(oids.filter((oid) => oid === root.oid)).toHaveLength(1);
  });

  it("reaches everything that is reachable", () => {
    expect(ancestry(store, merge.oid)).toHaveLength(4);
  });

  it("returns nothing for an oid that is not there", () => {
    expect(ancestry(store, "0000000")).toEqual([]);
  });
});
