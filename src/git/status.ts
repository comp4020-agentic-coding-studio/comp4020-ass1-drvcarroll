// Status is a comparison of three columns, never a stored field. Git's own
// answer to "what have I done" is derived every time, and deriving it here is
// what lets the file objects on the canvas be a pure function of the World.

import { blob } from "./objects.js";
import type { World } from "./repo.js";
import { headEntries } from "./repo.js";

export interface FileStatus {
  readonly path: string;
  readonly untracked: boolean; // in neither the index nor the last commit
  readonly staged: boolean; // the index differs from the last commit
  readonly modified: boolean; // the working file differs from the index
  readonly deleted: boolean; // tracked, but gone from the working tree
}

// One letter, in the order the visitor should read it: a file that is both
// staged and since modified is still telling them there is work to stage.
export function glyphFor(status: FileStatus): string {
  if (status.deleted) return "D";
  if (status.untracked) return "A";
  if (status.modified) return "M";
  if (status.staged) return "S";
  return "";
}

export function isClean(status: FileStatus): boolean {
  return glyphFor(status) === "";
}

// What the pointer-moving verbs actually care about. Git blocks a merge or a
// checkout on work it would have to overwrite, and a file it has never heard of
// is not that: without this, a project holding any untracked file could never
// merge at all.
export function isSettled(status: FileStatus): boolean {
  return status.untracked || isClean(status);
}

export function statusFor(world: World, path: string): FileStatus {
  const committed = headEntries(world.local)[path];
  const staged = world.index[path];
  const text = world.working[path];
  const working = text === undefined ? undefined : blob(text).oid;
  return {
    path,
    untracked: committed === undefined && staged === undefined,
    staged: staged !== committed,
    modified: working !== undefined && working !== staged,
    deleted: working === undefined && (staged ?? committed) !== undefined,
  };
}

// Every path any of the three columns knows about, sorted, so the drawing has
// a stable order and a deleted file does not simply vanish from the list.
export function status(world: World): FileStatus[] {
  const paths = new Set([
    ...Object.keys(headEntries(world.local)),
    ...Object.keys(world.index),
    ...Object.keys(world.working),
  ]);
  return [...paths].sort().map((path) => statusFor(world, path));
}
