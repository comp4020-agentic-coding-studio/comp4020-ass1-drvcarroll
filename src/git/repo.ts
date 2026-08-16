// The four places a change can be. Everything the visitor does is a pure
// function from one World to the next, so the drawing is a function of state
// and nothing on screen can go stale.

import type { ObjectStore } from "./objects.js";
import { blob, commit, put, readTree, tree } from "./objects.js";
import type { Merging } from "./merge.js";

// Detached HEAD is a real state the explainer reaches (checking out a commit),
// so it is in the type rather than special-cased later.
export type Head =
  | { readonly kind: "branch"; readonly name: string }
  | { readonly kind: "detached"; readonly oid: string };

export interface Repo {
  readonly objects: ObjectStore;
  readonly refs: Readonly<Record<string, string>>; // branch name -> commit oid
  readonly head: Head;
}

export interface World {
  readonly working: Readonly<Record<string, string>>; // path -> text
  readonly index: Readonly<Record<string, string>>; // path -> blob oid
  readonly local: Repo;
  readonly remote: Repo;
  // Set only while a merge is half-done. A state, not an error: every other
  // verb keeps working, and the same commit verb finishes it.
  readonly merging?: Merging;
}

export function emptyRepo(): Repo {
  return { objects: {}, refs: {}, head: { kind: "branch", name: "main" } };
}

export function emptyWorld(): World {
  return {
    working: {},
    index: {},
    local: emptyRepo(),
    remote: emptyRepo(),
  };
}

// The commit HEAD names, if there is one. Undefined before the first commit,
// which is a state the visitor spends real time in.
export function headOid(repo: Repo): string | undefined {
  return repo.head.kind === "detached"
    ? repo.head.oid
    : repo.refs[repo.head.name];
}

// What the last commit said the files were. Empty before the first commit.
export function headEntries(repo: Repo): Readonly<Record<string, string>> {
  const oid = headOid(repo);
  const snapshot = oid === undefined ? undefined : repo.objects[oid];
  if (snapshot?.kind !== "commit") return {};
  return readTree(repo.objects, snapshot.tree)?.entries ?? {};
}

export function edit(world: World, path: string, text: string): World {
  return { ...world, working: { ...world.working, [path]: text } };
}

// Deletes from the working tree only. Git can still get the content back from
// the index or a commit, which is the point of drawing them separately.
export function remove(world: World, path: string): World {
  const working = { ...world.working };
  delete working[path];
  return { ...world, working };
}

// Staging writes the blob into .git straight away, exactly as git does. The
// index holds a name, not a copy, and that is why staging feels cheap.
export function stage(world: World, path: string): World {
  const text = world.working[path];
  if (text === undefined) return world;
  const object = blob(text);
  return {
    ...world,
    index: { ...world.index, [path]: object.oid },
    local: { ...world.local, objects: put(world.local.objects, object) },
  };
}

// Back to what HEAD says, or out of the index entirely if HEAD never had it.
// The blob stays in .git: unstaging loses nothing.
export function unstage(world: World, path: string): World {
  const index = { ...world.index };
  const committed = headEntries(world.local)[path];
  if (committed === undefined) delete index[path];
  else index[path] = committed;
  return { ...world, index };
}

// The one genuinely lossy verb in the whole explainer, and the only thing git
// cannot get back for you.
export function discard(world: World, path: string): World {
  const oid = world.index[path];
  const object = oid === undefined ? undefined : world.local.objects[oid];
  if (object?.kind !== "blob") return remove(world, path);
  return edit(world, path, object.text);
}

// Seals the index into a snapshot. Moves the branch HEAD is on, or leaves a
// detached HEAD pointing at the new commit.
export function commitIndex(world: World, message: string): World {
  const parent = headOid(world.local);
  // A merge commit has two parents, and that is the entire visual explanation
  // of a merge: two lines converging into one circle.
  const parents = [
    ...(parent === undefined ? [] : [parent]),
    ...(world.merging === undefined ? [] : [world.merging.theirs]),
  ];
  const snapshot = tree(world.index);
  const sealed = commit({ tree: snapshot.oid, parents, message });
  const objects = put(world.local.objects, snapshot, sealed);
  const head = world.local.head;
  const { merging: _done, ...rest } = world;
  return {
    ...rest,
    local: {
      objects,
      refs:
        head.kind === "branch"
          ? { ...world.local.refs, [head.name]: sealed.oid }
          : world.local.refs,
      head: head.kind === "branch" ? head : { kind: "detached", oid: sealed.oid },
    },
  };
}
