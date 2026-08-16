// Stash is not a special place. It is a commit, off to the side, with a name
// pointing at it - which is why it draws in its own lane like every other tip
// and why getting the work back is just reading a tree.

import { blob, commit, put, readBlob, tree } from "./objects.js";
import type { World } from "./repo.js";
import { headOid } from "./repo.js";
import { materialise } from "./branch.js";
import { isClean, isSettled, status } from "./status.js";

export const STASH = "stash";

// Puts the working tree somewhere safe and hands back a clean one. Refuses
// when there is nothing to put away and when one is already held, because a
// stack of them teaches nothing the first one has not already taught.
export function stash(world: World): World {
  if (STASH in world.local.refs) return world;
  if (status(world).every(isClean)) return world;

  let objects = world.local.objects;
  const entries: Record<string, string> = {};
  for (const [path, text] of Object.entries(world.working)) {
    const content = blob(text);
    objects = put(objects, content);
    entries[path] = content.oid;
  }
  const snapshot = tree(entries);
  const parent = headOid(world.local);
  const sealed = commit({
    tree: snapshot.oid,
    parents: parent === undefined ? [] : [parent],
    message: "work in progress",
  });
  return materialise({
    ...world,
    local: {
      ...world.local,
      objects: put(objects, snapshot, sealed),
      refs: { ...world.local.refs, [STASH]: sealed.oid },
    },
  });
}

// Reads the stashed snapshot back over your files and drops the name. The
// commit stays in .git, unreachable, exactly as git leaves it.
export function pop(world: World): World {
  // Refuse on a dirty tree: popping over unsaved work would silently
  // overwrite it, the one loss stash exists to prevent.
  if (!status(world).every(isSettled)) return world;
  const at = world.local.refs[STASH];
  const held = at === undefined ? undefined : world.local.objects[at];
  if (held?.kind !== "commit") return world;
  const snapshot = world.local.objects[held.tree];
  if (snapshot?.kind !== "tree") return world;

  // Untracked files survive, exactly as materialise() keeps them: stash only
  // ever speaks for what it held, not for what showed up since.
  const working = { ...world.working };
  for (const [path, oid] of Object.entries(snapshot.entries)) {
    working[path] = readBlob(world.local.objects, oid)?.text ?? "";
  }
  const refs = { ...world.local.refs };
  delete refs[STASH];
  return { ...world, working, local: { ...world.local, refs } };
}
