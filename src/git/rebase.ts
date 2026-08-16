// Rebase: the same work, said again on top of someone else's. Each commit is
// replayed as a new commit whose parent is different, and since a commit's oid
// is derived from its parents, different hashes fall out of the model rather
// than out of a caption. The originals stay in the store, unreachable.

import { commit, put, tree } from "./objects.js";
import { ancestry, readCommit } from "./objects.js";
import type { World } from "./repo.js";
import { headOid } from "./repo.js";
import { materialise, isAncestor } from "./branch.js";
import { combine, mergeBase } from "./merge.js";
import { isSettled, status } from "./status.js";

// Whether replaying is the operation that applies: there is somewhere to go,
// nothing half-done in the way, and the two lines have actually diverged.
export function canRebase(world: World, onto: string): boolean {
  const theirs = world.local.refs[onto];
  const ours = headOid(world.local);
  if (theirs === undefined || ours === undefined || theirs === ours) {
    return false;
  }
  if (world.local.head.kind !== "branch" || world.merging !== undefined) {
    return false;
  }
  if (!status(world).every(isSettled)) return false;
  // Genuinely diverged, both ways. If either line already contains the other
  // there is nothing to replay, and pretending otherwise is a fast-forward.
  if (isAncestor(world.local.objects, ours, theirs)) return false;
  return !isAncestor(world.local.objects, theirs, ours);
}

// Replays every commit of yours that they do not have, oldest first. A replay
// that would conflict is refused whole: a half-rebased branch is a state this
// explainer has no way to draw honestly, and merge already teaches conflicts.
export function rebase(world: World, onto: string): World {
  if (!canRebase(world, onto)) return world;
  const head = world.local.head;
  if (head.kind !== "branch") return world;
  const theirs = world.local.refs[onto] as string;
  const ours = headOid(world.local) as string;
  const base = mergeBase(world.local.objects, ours, theirs);
  if (base === undefined) return world;

  // Oldest first, and only the ones past the point the two lines agreed on.
  const mine = ancestry(world.local.objects, ours)
    .filter((c) => c.oid !== base && !isAncestor(world.local.objects, c.oid, base))
    .reverse();

  let objects = world.local.objects;
  let tip = theirs;
  for (const c of mine) {
    const [parent] = c.parents;
    if (parent === undefined) return world;
    // Their change relative to its own parent, laid on the new tip: the same
    // three columns a merge uses, so nothing new has to be trusted here.
    const done = combine(objects, parent, tip, c.oid, onto);
    if (done.conflicts.length > 0) return world;
    const snapshot = tree(done.index);
    const replayed = commit({
      tree: snapshot.oid,
      parents: [tip],
      message: c.message,
    });
    objects = put(objects, snapshot, replayed);
    tip = replayed.oid;
  }

  return materialise({
    ...world,
    local: {
      ...world.local,
      objects,
      refs: { ...world.local.refs, [head.name]: tip },
    },
  });
}

// The commits nothing points at any more: still in .git, still real, and drawn
// ghosted because that is exactly what git leaves behind.
export function unreachable(world: World): string[] {
  const repo = world.local;
  const live = new Set<string>();
  const head = headOid(repo);
  for (const tip of [...(head === undefined ? [] : [head]),
    ...Object.values(repo.refs)]) {
    for (const c of ancestry(repo.objects, tip)) live.add(c.oid);
  }
  return Object.values(repo.objects)
    .filter((o) => o.kind === "commit" && !live.has(o.oid))
    .map((o) => o.oid)
    .filter((oid) => readCommit(repo.objects, oid) !== undefined);
}
