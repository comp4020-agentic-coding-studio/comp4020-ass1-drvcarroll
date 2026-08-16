// The curriculum. A stage is a concept plus a predicate saying whether the
// world shows evidence of it, so nothing here can advance without the visitor
// changing the model.
//
// Nothing in this file returns a permission: a stage is a fact about the world,
// and the predicates cannot see the interface at all. The page does gate which
// verbs it draws - a visitor who has never heard of git should not meet rebase
// in their first minute - but it does that by reading the set these functions
// return, which keeps the record honest and the gating one layer up where it
// can be changed without touching the curriculum.

import type { World } from "../git/repo.js";
import { headOid } from "../git/repo.js";
import { isAncestor } from "../git/branch.js";
import { STASH } from "../git/stash.js";
import { unreachable } from "../git/rebase.js";

export interface Stage {
  readonly id: string;
  readonly teaches: string;
  readonly prompt: string;
  // The entity the prompt is about, so the suggestion can be drawn beside it
  // rather than at the top of the page pointing at nothing.
  readonly at: string;
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
    prompt: "Change a line in any file, then watch what git notices.",
    at: "files",
    met: (world, start) =>
      JSON.stringify(world.working) !== JSON.stringify(start.working),
  },
  {
    id: "stage",
    teaches: "The index is a second place on the same machine.",
    prompt: "Git has noticed. Press Save to put that change in the index.",
    at: "files",
    met: (world) => Object.keys(world.index).length > 0,
  },
  {
    id: "commit",
    teaches: "A commit is a snapshot with a hash, stored locally.",
    prompt: "Say what the change does, then press Commit.",
    at: "index",
    met: (world) => headOid(world.local) !== undefined,
  },
  // Push, Gary's reply, and the merge that settles it come before branching:
  // collaboration is the reason git exists, and a beginner who has never seen a
  // second person touch the repo has no reason to care what a branch is.
  {
    id: "push",
    teaches: "The server is a different computer, and push is the only way up.",
    prompt: "Nothing has left your machine yet. Press Push.",
    at: "git",
    met: (world) => headOid(world.remote) !== undefined,
  },
  {
    id: "diverged",
    teaches: "A push is refused when the server holds work you do not.",
    prompt: "Gary pushed too. Try pushing again and read what comes back.",
    at: "git",
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
    prompt: "Press Pull to bring Gary's commit down, then merge it in.",
    at: "git",
    met: (world) =>
      Object.values(world.local.objects).some(
        (o) => o.kind === "commit" && o.parents.length >= 2,
      ),
  },
  // Blob sharing waits until the loop has run: it is the first lesson that is
  // about how git stores things rather than about getting work to a colleague,
  // and putting it between commit and push stalled the one narrative that has to
  // land first.
  {
    id: "reuse",
    teaches: "Commits chain to a parent, and share the blobs they can.",
    prompt: "Change another file and commit that too. Watch what gets reused.",
    at: "files",
    met: (world) => commits(world) >= 2,
  },
  {
    id: "branch",
    teaches: "A branch is a pointer, not a copy.",
    prompt: "Press Branch, give it a name, and start one here.",
    at: "git",
    met: (world) => local(world).length >= 2,
  },
  {
    id: "checkout",
    teaches: "Checking out is what puts different files on your disk.",
    prompt: "Click that branch's chip to move onto it, then commit something.",
    at: "git",
    met: (world) =>
      world.local.head.kind === "branch" && world.local.head.name !== "main",
  },
  {
    id: "stash",
    teaches: "Stash is a commit off to the side, not a special place.",
    prompt: "Change a file, then put the work aside without committing it.",
    at: "files",
    met: (world) => Object.keys(world.local.refs).includes(STASH),
  },
  {
    id: "rebase",
    teaches: "Replaying changes the hashes, because a commit includes its parent.",
    prompt: "Diverged again? Replay your work onto theirs instead of merging.",
    at: "git",
    met: (world) => unreachable(world).length > 0,
  },
  {
    id: "conflict",
    teaches: "A conflict is a state, resolved with the verbs you already have.",
    prompt: "Change the same file Gary did, commit it, then merge his too.",
    at: "files",
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
export function suggested(met: ReadonlySet<string>): Stage | undefined {
  return STAGES.find((stage) => !met.has(stage.id));
}

export function suggestion(met: ReadonlySet<string>): string | undefined {
  return suggested(met)?.prompt;
}
