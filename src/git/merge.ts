// A real merge: the one operation that needs three snapshots rather than two.
// Comparing both sides against the commit they last agreed on is what lets git
// take one change from each without being told which is which.

import type { ObjectStore } from "./objects.js";
import { ancestry, readBlob, readTree } from "./objects.js";
import type { World } from "./repo.js";
import { headOid } from "./repo.js";
import { materialise } from "./branch.js";
import { isSettled, status } from "./status.js";

export interface Merging {
  readonly name: string; // the branch being merged in
  readonly theirs: string; // the commit it points at
  readonly conflicts: readonly string[];
}

// The most recent commit both sides can reach. Everything a merge does is
// measured from here, which is why an unrelated history cannot be merged.
export function mergeBase(
  objects: ObjectStore,
  ours: string,
  theirs: string,
): string | undefined {
  const mine = new Set(ancestry(objects, ours).map((c) => c.oid));
  return ancestry(objects, theirs).find((c) => mine.has(c.oid))?.oid;
}

function entriesOf(
  objects: ObjectStore,
  oid: string | undefined,
): Readonly<Record<string, string>> {
  const c = oid === undefined ? undefined : ancestry(objects, oid)[0];
  if (c === undefined) return {};
  return readTree(objects, c.tree)?.entries ?? {};
}

const textOf = (objects: ObjectStore, oid: string | undefined): string =>
  oid === undefined ? "" : (readBlob(objects, oid)?.text ?? "");

// Written into the file itself, because the resolution has to happen where the
// visitor already knows how to work: edit the text, stage it, commit it.
function markers(mine: string, theirs: string, name: string): string {
  return `<<<<<<< yours\n${mine}=======\n${theirs}>>>>>>> ${name}\n`;
}

export interface Merged {
  readonly working: Record<string, string>;
  readonly index: Record<string, string>;
  readonly conflicts: string[];
}

// Three columns again, exactly as status is: what we agreed on, what I did,
// what they did. A path only conflicts when both sides moved it, differently.
export function combine(
  objects: ObjectStore,
  base: string | undefined,
  ours: string,
  theirs: string,
  name: string,
): Merged {
  const b = entriesOf(objects, base);
  const o = entriesOf(objects, ours);
  const t = entriesOf(objects, theirs);
  const out: Merged = { working: {}, index: {}, conflicts: [] };

  for (const path of new Set([...Object.keys(o), ...Object.keys(t)])) {
    const mine = o[path];
    const yours = t[path];
    const was = b[path];
    const take = (oid: string | undefined): void => {
      if (oid === undefined) return;
      out.index[path] = oid;
      out.working[path] = textOf(objects, oid);
    };

    if (mine === yours || yours === was) take(mine);
    else if (mine === was) take(yours);
    else {
      out.conflicts.push(path);
      // Deliberately not staged: a conflicted path is the one thing the index
      // must not be holding, or committing would seal the markers.
      out.working[path] = markers(
        textOf(objects, mine),
        textOf(objects, yours),
        name,
      );
    }
  }
  return out;
}

// Leaves the world mid-merge when anything conflicts. That state is a state,
// not an error: the picture keeps working and so does every other verb.
export function startMerge(world: World, name: string): World {
  const theirs = world.local.refs[name];
  const ours = headOid(world.local);
  if (theirs === undefined || ours === undefined || theirs === ours) {
    return world;
  }
  // Refuse on a dirty tree, same as merge() and rebase(): combine() reads
  // only the committed trees, so an uncommitted edit would be silently
  // overwritten by whatever the merge produces for that path.
  if (!status(world).every(isSettled)) return world;
  const base = mergeBase(world.local.objects, ours, theirs);
  if (base === undefined) return world;
  const done = combine(world.local.objects, base, ours, theirs, name);
  // A merge decides about tracked paths only. A file git has never seen is not
  // the merge's business, and wiping it would be the one loss git never risks.
  const working = { ...world.working };
  for (const path of [
    ...Object.keys(entriesOf(world.local.objects, ours)),
    ...Object.keys(entriesOf(world.local.objects, theirs)),
  ]) {
    delete working[path];
  }
  return {
    ...world,
    working: { ...working, ...done.working },
    index: done.index,
    merging: { name, theirs, conflicts: done.conflicts },
  };
}

// Abandoning a half-done merge is a reversal like any other, and it is the one
// people reach for most, so it is a verb rather than a rescue. Nothing was
// committed, so putting HEAD's snapshot back is the whole of it.
export function abortMerge(world: World): World {
  if (world.merging === undefined) return world;
  const { merging: _, ...rest } = world;
  return materialise(rest);
}
