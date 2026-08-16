// The only two verbs that cross the gap. Both are copies between two object
// stores of exactly the same kind, which is why the server and .git are drawn
// as the same cylinder: pushing is not uploading, it is sending objects the
// other machine does not have yet.

import { ancestry, blob, commit, put, tree } from "./objects.js";
import type { World } from "./repo.js";
import { headOid } from "./repo.js";
import { isAncestor } from "./branch.js";

// Refused when the server holds work you do not. That refusal is a lesson, not
// an error: it is the whole reason fetch exists.
export function canPush(world: World): boolean {
  const head = world.local.head;
  if (head.kind !== "branch") return false;
  const mine = world.local.refs[head.name];
  if (mine === undefined) return false;
  const theirs = world.remote.refs[head.name];
  if (theirs === mine) return false;
  return theirs === undefined || isAncestor(world.local.objects, theirs, mine);
}

export function push(world: World): World {
  const head = world.local.head;
  if (head.kind !== "branch" || !canPush(world)) return world;
  const mine = world.local.refs[head.name] as string;

  // Send the commits, their trees, and the blobs those name. Anything the
  // server already has is simply overwritten with the identical object.
  const objects = { ...world.remote.objects };
  for (const c of ancestry(world.local.objects, mine)) {
    objects[c.oid] = c;
    const snapshot = world.local.objects[c.tree];
    if (snapshot?.kind !== "tree") continue;
    objects[snapshot.oid] = snapshot;
    for (const oid of Object.values(snapshot.entries)) {
      const content = world.local.objects[oid];
      if (content !== undefined) objects[oid] = content;
    }
  }

  return {
    ...world,
    remote: {
      objects,
      refs: { ...world.remote.refs, [head.name]: mine },
      head: { kind: "branch", name: head.name },
    },
  };
}

// Brings objects across without touching your files. Nothing you can see move
// changes until you merge, which is the difference people most often miss.
export function fetch(world: World): World {
  const theirs = headOid(world.remote);
  if (theirs === undefined) return world;
  const objects = { ...world.local.objects };
  for (const c of ancestry(world.remote.objects, theirs)) {
    objects[c.oid] = c;
    const snapshot = world.remote.objects[c.tree];
    if (snapshot?.kind !== "tree") continue;
    objects[snapshot.oid] = snapshot;
    for (const oid of Object.values(snapshot.entries)) {
      const content = world.remote.objects[oid];
      if (content !== undefined) objects[oid] = content;
    }
  }
  const name = world.remote.head.kind === "branch"
    ? world.remote.head.name
    : "main";
  return {
    ...world,
    local: {
      ...world.local,
      objects,
      refs: { ...world.local.refs, [`origin/${name}`]: theirs },
    },
  };
}

// Someone else, pushing while you were working. It is the only way to reach a
// refused push, and a refused push is the reason fetch exists at all.
export function teammatePushes(
  world: World,
  path: string,
  text: string,
  message: string,
): World {
  const name =
    world.remote.head.kind === "branch" ? world.remote.head.name : "main";
  const parent = world.remote.refs[name];
  const content = blob(text);
  const entries = { ...entriesAt(world.remote, parent), [path]: content.oid };
  const snapshot = tree(entries);
  const sealed = commit({
    tree: snapshot.oid,
    parents: parent === undefined ? [] : [parent],
    message,
  });
  return {
    ...world,
    remote: {
      objects: put(world.remote.objects, content, snapshot, sealed),
      refs: { ...world.remote.refs, [name]: sealed.oid },
      head: { kind: "branch", name },
    },
  };
}

function entriesAt(
  repo: World["remote"],
  oid: string | undefined,
): Readonly<Record<string, string>> {
  const c = oid === undefined ? undefined : repo.objects[oid];
  if (c?.kind !== "commit") return {};
  const snapshot = repo.objects[c.tree];
  return snapshot?.kind === "tree" ? snapshot.entries : {};
}
