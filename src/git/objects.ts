// The object model. Git stores three kinds of thing, names each one by a hash
// of its content, and everything else in the explainer is pointers into here.

import { oidFor } from "./hash.js";

export interface Blob {
  readonly kind: "blob";
  readonly oid: string;
  readonly text: string;
}

// Flat: paths are keys, there are no subtrees. A simplification, declared in
// STRUCTURE.md, and the only one the drawing depends on.
export interface Tree {
  readonly kind: "tree";
  readonly oid: string;
  readonly entries: Readonly<Record<string, string>>;
}

export interface Commit {
  readonly kind: "commit";
  readonly oid: string;
  readonly tree: string;
  readonly parents: readonly string[];
  readonly message: string;
}

export type GitObject = Blob | Tree | Commit;

// Keyed by oid, so writing the same content twice is one entry rather than two.
export type ObjectStore = Readonly<Record<string, GitObject>>;

export function blob(text: string): Blob {
  return { kind: "blob", oid: oidFor(`blob ${text.length}\0${text}`), text };
}

// Entries are sorted before hashing, so a tree's name depends on what is in it
// and never on the order it was built up in.
export function tree(entries: Readonly<Record<string, string>>): Tree {
  const lines = Object.keys(entries)
    .sort()
    .map((path) => `${path} ${entries[path] ?? ""}`);
  return { kind: "tree", oid: oidFor(`tree\0${lines.join("\n")}`), entries };
}

// The parents go into the hash. That is the whole reason rebase produces new
// commit ids from unchanged content, and it costs one line here rather than a
// caption later.
export function commit(spec: {
  readonly tree: string;
  readonly parents: readonly string[];
  readonly message: string;
}): Commit {
  const header = [
    `tree ${spec.tree}`,
    ...spec.parents.map((p) => `parent ${p}`),
  ].join("\n");
  return {
    kind: "commit",
    oid: oidFor(`commit\0${header}\n\n${spec.message}`),
    tree: spec.tree,
    parents: spec.parents,
    message: spec.message,
  };
}

// Idempotent because the key is the content: writing a blob you already have
// is a no-op, which is what "shared rather than copied" means.
export function put(store: ObjectStore, ...objects: GitObject[]): ObjectStore {
  const next = { ...store };
  for (const object of objects) next[object.oid] = object;
  return next;
}

export function readBlob(store: ObjectStore, oid: string): Blob | undefined {
  const found = store[oid];
  return found?.kind === "blob" ? found : undefined;
}

export function readTree(store: ObjectStore, oid: string): Tree | undefined {
  const found = store[oid];
  return found?.kind === "tree" ? found : undefined;
}

export function readCommit(
  store: ObjectStore,
  oid: string,
): Commit | undefined {
  const found = store[oid];
  return found?.kind === "commit" ? found : undefined;
}

// Walks first-parent-first, breadth first, skipping objects already seen. Used
// to draw a graph and to find a merge base; both want every reachable commit
// exactly once.
export function ancestry(store: ObjectStore, from: string): Commit[] {
  const seen = new Set<string>();
  const out: Commit[] = [];
  const queue = [from];
  while (queue.length > 0) {
    const oid = queue.shift() ?? "";
    if (seen.has(oid)) continue;
    seen.add(oid);
    const found = readCommit(store, oid);
    if (found === undefined) continue;
    out.push(found);
    queue.push(...found.parents);
  }
  return out;
}
