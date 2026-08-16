// The curriculum. A stage is a concept plus a predicate saying whether the
// world shows evidence of it, so nothing here can advance without the visitor
// changing the model. Stages record what has happened; they never gate what
// may happen next, which is why nothing in this file returns a permission.

import type { World } from "../git/repo.js";
import { headOid } from "../git/repo.js";
import { isAncestor } from "../git/branch.js";
import { STASH } from "../git/stash.js";

export interface Stage {
  readonly id: string;
  readonly teaches: string;
  readonly prompt: string;
  // Two states in, a boolean out. Comparing against the world the visitor
  // arrived to is what lets "you changed a file" be a fact about state rather
  // than a counter of clicks.
  met(world: World, start: World): boolean;
}

// Branches you made: not the remote-tracking names fetch writes for you, and
// not the stash, which is a name for a commit but never a branch you are on.
function local(world: World): string[] {
  return Object.keys(world.local.refs).filter(
    (n) => !n.startsWith("origin/") && n !== STASH,
  );
}

function commits(world: World): number {
  return Object.values(world.local.objects).filter((o) => o.kind === "commit")
    .length;
}

export const STAGES: readonly Stage[] = [
  {
    id: "edit",
    teaches: "Your files are just files on your machine.",
    prompt: "Open your files and change a line. Watch what git does.",
    met: (world, start) =>
      JSON.stringify(world.working) !== JSON.stringify(start.working),
  },
  {
    id: "stage",
    teaches: "The index is a second place on the same machine.",
    prompt: "Git has noticed. Stage that change into the index.",
    met: (world) => Object.keys(world.index).length > 0,
  },
  {
    id: "commit",
    teaches: "A commit is a snapshot with a hash, stored locally.",
    prompt: "The index is holding your change. Open it and commit.",
    met: (world) => headOid(world.local) !== undefined,
  },
  {
    id: "reuse",
    teaches: "Commits chain to a parent, and share the blobs they can.",
    prompt: "Change another file and commit that too. Watch what gets reused.",
    met: (world) => commits(world) >= 2,
  },
  {
    id: "branch",
    teaches: "A branch is a pointer, not a copy.",
    prompt: "Open the main chip. A branch is just a name for a commit.",
    met: (world) => local(world).length >= 2,
  },
  {
    id: "checkout",
    teaches: "Checking out is what puts different files on your disk.",
    prompt: "Check out your new branch and commit something on it.",
    met: (world) =>
      world.local.head.kind === "branch" && world.local.head.name !== "main",
  },
  {
    id: "push",
    teaches: "The server is a different computer, and push is the only way up.",
    prompt: "Nothing has left your machine yet. Open the server and push.",
    met: (world) => headOid(world.remote) !== undefined,
  },
  {
    id: "diverged",
    teaches: "A push is refused when the server holds work you do not.",
    prompt: "Let a teammate push from the server, then try to push again.",
    met: (world) => {
      const theirs = headOid(world.remote);
      const mine = headOid(world.local);
      if (theirs === undefined || mine === undefined) return false;
      return !isAncestor(world.local.objects, theirs, mine);
    },
  },
  {
    id: "merge",
    teaches: "A merge commit has two parents, and that is the whole of it.",
    prompt: "Fetch their work, then merge origin/main from your branch chip.",
    met: (world) =>
      Object.values(world.local.objects).some(
        (o) => o.kind === "commit" && o.parents.length >= 2,
      ),
  },
  {
    id: "stash",
    teaches: "Stash is a commit off to the side, not a special place.",
    prompt: "Change a file, then try to check out another branch. Then stash.",
    met: (world) => Object.keys(world.local.refs).includes(STASH),
  },
  {
    id: "conflict",
    teaches: "A conflict is a state, resolved with the verbs you already have.",
    prompt: "Change README.md yourself, let them change it too, and merge.",
    met: (world) => (world.merging?.conflicts.length ?? 0) > 0,
  },
];

// Union, never replacement: a stage met stays met even when the world moves
// past the evidence, because a visitor who commits has still learned what an
// edit was. This is memory of state, not a count of actions.
export function record(
  met: ReadonlySet<string>,
  world: World,
  start: World,
): ReadonlySet<string> {
  const next = new Set(met);
  for (const stage of STAGES) if (stage.met(world, start)) next.add(stage.id);
  return next;
}

// The first concept not yet shown, whatever order they arrived in. Undefined
// once they are all met: the scaffolding retires and free play begins.
export function suggestion(met: ReadonlySet<string>): string | undefined {
  return STAGES.find((stage) => !met.has(stage.id))?.prompt;
}
