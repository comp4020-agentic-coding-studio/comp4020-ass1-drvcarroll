// Branching, checking out, fast-forwarding, and the one reset the explainer
// needs. Every verb here is a pointer move: no object is ever created, copied
// or destroyed, which is the entire lesson these operations carry.

import type { ObjectStore } from "./objects.js";
import { ancestry, readBlob, readCommit, readTree } from "./objects.js";
import type { World } from "./repo.js";
import { headEntries, headOid } from "./repo.js";
import { isSettled, status } from "./status.js";

export function isAncestor(
  objects: ObjectStore,
  older: string,
  newer: string,
): boolean {
  return ancestry(objects, newer).some((c) => c.oid === older);
}

// A branch is a name for a commit you already have. Nothing is copied, which
// is why this is instant however large the project is.
export function branch(world: World, name: string): World {
  const at = headOid(world.local);
  if (at === undefined || name in world.local.refs) return world;
  return {
    ...world,
    local: { ...world.local, refs: { ...world.local.refs, [name]: at } },
  };
}

// Writes HEAD's snapshot back out over the files and the index. Every verb
// that moves HEAD ends here, which is why the picture can never show a branch
// pointing one way and the files saying another.
export function materialise(world: World): World {
  const entries = headEntries(world.local);
  const working: Record<string, string> = {};
  // Untracked files survive: git only writes over what it tracks, and throwing
  // away a file it has never heard of would be losing the visitor's work.
  for (const path of Object.keys(world.working)) {
    if (entries[path] !== undefined || world.index[path] !== undefined) continue;
    working[path] = world.working[path] as string;
  }
  for (const [path, oid] of Object.entries(entries)) {
    working[path] = readBlob(world.local.objects, oid)?.text ?? "";
  }
  return { ...world, index: entries, working };
}

// Refuses on a dirty tree rather than silently throwing work away. The refusal
// is the lesson: this is the wall the visitor hits on the way to stash.
export function checkout(world: World, name: string): World {
  const at = world.local.refs[name];
  if (at === undefined || !status(world).every(isSettled)) return world;
  return materialise({
    ...world,
    local: { ...world.local, head: { kind: "branch", name } },
  });
}

// Fast-forward only: when the branch you are on is already an ancestor of the
// one you are merging, there is nothing to combine and the pointer just slides
// forward. Anything else is left alone, so the picture never lies about it.
export function merge(world: World, name: string): World {
  const head = world.local.head;
  const from = world.local.refs[name];
  const at = headOid(world.local);
  if (head.kind !== "branch" || from === undefined || at === undefined) {
    return world;
  }
  if (!isAncestor(world.local.objects, at, from)) return world;
  if (!status(world).every(isSettled)) return world;
  return materialise({
    ...world,
    local: {
      ...world.local,
      refs: { ...world.local.refs, [head.name]: from },
    },
  });
}

export function canFastForward(world: World, name: string): boolean {
  const from = world.local.refs[name];
  const at = headOid(world.local);
  if (from === undefined || at === undefined || from === at) return false;
  return isAncestor(world.local.objects, at, from);
}

// Moving the branch you are on to any commit still in .git. This is what makes
// an undone rebase possible: the old commits were never deleted, only left
// with nothing pointing at them.
export function resetTo(world: World, oid: string): World {
  const head = world.local.head;
  if (
    head.kind !== "branch" ||
    world.merging !== undefined ||
    readCommit(world.local.objects, oid) === undefined
  ) {
    return world;
  }
  return materialise({
    ...world,
    local: { ...world.local, refs: { ...world.local.refs, [head.name]: oid } },
  });
}

// Undoing a commit is moving the pointer back, and that is the whole reason a
// branch being a pointer is worth teaching first. The commit is not deleted;
// the index still holds what went into it, so the change is staged again.
export function resetBack(world: World): World {
  const head = world.local.head;
  const at = headOid(world.local);
  if (head.kind !== "branch" || at === undefined || world.merging !== undefined) {
    return world;
  }
  const [previous] = ancestry(world.local.objects, at)[0]?.parents ?? [];
  const refs = { ...world.local.refs };
  if (previous === undefined) delete refs[head.name];
  else refs[head.name] = previous;
  const back: World = { ...world, local: { ...world.local, refs } };
  // Keep the snapshot in the index so the visitor can simply commit again.
  const undone = readTree(
    world.local.objects,
    ancestry(world.local.objects, at)[0]?.tree ?? "",
  );
  return { ...back, index: undone?.entries ?? back.index };
}
