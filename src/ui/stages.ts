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

// Every control the page can offer, named once so a stage can say which of
// them its instruction is about. The page tags each button with one of these
// and locks the rest while the walkthrough is running, so the only things
// that can be pressed are the things the prompt just named.
export type Control =
  | "files" // the file list and the editor
  | "save"
  | "commit" // the message field and Commit
  | "push"
  | "pull"
  | "merge"
  | "branch"
  | "checkout" // a branch chip on a commit row
  | "stash" // Put aside and Bring it back
  | "rebase"
  | "reset"; // Move the branch back, and the ghost row's reversal

export interface Stage {
  readonly id: string;
  readonly teaches: string;
  readonly prompt: string;
  // The entity the prompt is about, so the suggestion can be drawn beside it
  // rather than at the top of the page pointing at nothing.
  readonly at: string;
  // What the visitor may touch while this stage is the current one. It has to
  // cover every control the instruction needs, including the ones that only
  // set up the state it asks for - a stage that locks away a step on the way
  // to its own goal is a dead end, which is the one failure worse than an
  // unlocked page. The sets widen toward the end as the scaffolding fades.
  readonly allow: readonly Control[];
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
    prompt: "Click a file in the list, then type a change in the editor.",
    at: "files",
    allow: ["files"],
    met: (world, start) =>
      JSON.stringify(world.working) !== JSON.stringify(start.working),
  },
  {
    id: "stage",
    teaches: "The index is a second place on the same machine.",
    prompt: "Git has noticed. Press Save to put that change in the index.",
    at: "files",
    allow: ["files", "save"],
    met: (world) => Object.keys(world.index).length > 0,
  },
  {
    id: "commit",
    teaches: "A commit is a snapshot with a hash, stored locally.",
    prompt: "Type what the change does in the message box, then press Commit.",
    at: "index",
    allow: ["files", "save", "commit"],
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
    allow: ["push"],
    met: (world) => headOid(world.remote) !== undefined,
  },
  {
    id: "diverged",
    teaches: "A push is refused when the server holds work you do not.",
    prompt: "A teammate pushed too. Press Push again and read what comes back.",
    at: "git",
    allow: ["push"],
    met: (world) => {
      const theirs = headOid(world.remote);
      const mine = headOid(world.local);
      if (theirs === undefined || mine === undefined) return false;
      return !isAncestor(world.local.objects, theirs, mine);
    },
  },
  // Your own second commit comes before the merge, and has to. A merge commit
  // needs both sides to have moved away from a commit they shared: while the
  // only work that has moved is theirs, pulling is a fast-forward and the
  // pointer simply slides onto their commit. Asking for the merge first left
  // the visitor doing exactly as told and watching nothing happen, because
  // there was no second parent for git to record.
  {
    id: "reuse",
    teaches: "Commits chain to a parent, and share the blobs they can.",
    prompt: "Pick another file, edit it, then press Save and Commit.",
    at: "files",
    allow: ["files", "save", "commit"],
    met: (world) => commits(world) >= 2,
  },
  {
    id: "merge",
    teaches: "A merge commit has two parents, and that is the whole of it.",
    prompt:
      "You both moved. Press Pull, then Merge origin/main, then Commit.",
    at: "git",
    allow: ["pull", "merge", "commit", "files", "save"],
    met: (world) =>
      Object.values(world.local.objects).some(
        (o) => o.kind === "commit" && o.parents.length >= 2,
      ),
  },
  {
    id: "branch",
    teaches: "A branch is a pointer, not a copy.",
    prompt: "Press Branch, type a name, then press Start a branch here.",
    at: "git",
    allow: ["branch"],
    met: (world) => local(world).length >= 2,
  },
  {
    id: "checkout",
    teaches: "Checking out is what puts different files on your disk.",
    prompt: "Click that branch's blue chip to move onto it.",
    at: "git",
    allow: ["checkout"],
    met: (world) =>
      world.local.head.kind === "branch" && world.local.head.name !== "main",
  },
  {
    id: "stash",
    teaches: "Stash is a commit off to the side, not a special place.",
    prompt: "Edit a file, then press Put aside instead of Save.",
    at: "files",
    allow: ["files", "stash"],
    met: (world) => Object.keys(world.local.refs).includes(STASH),
  },
  // The last two need most of the page back: reaching a replay or a collision
  // means committing, pushing and pulling your way into one first. By here the
  // verbs have all been met, so widening the set is the scaffolding fading
  // rather than a hole in it.
  {
    id: "rebase",
    teaches: "Replaying changes the hashes, because a commit includes its parent.",
    prompt: "Diverge again, then press Replay instead of Merge.",
    at: "git",
    allow: [
      "files",
      "save",
      "commit",
      "push",
      "pull",
      "rebase",
      "merge",
      "stash",
      "checkout",
    ],
    met: (world) => unreachable(world).length > 0,
  },
  {
    id: "conflict",
    teaches: "A conflict is a state, resolved with the verbs you already have.",
    prompt: "Edit the same file a teammate did, press Save and Commit, then Merge.",
    at: "files",
    allow: [
      "files",
      "save",
      "commit",
      "push",
      "pull",
      "merge",
      "rebase",
      "stash",
      "checkout",
    ],
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

// What the visitor may touch, or undefined for "anything". Undefined is the
// answer once the stages are exhausted: the scaffolding retires and the page
// becomes the free-play model it was always underneath. Keeping that as one
// exported function means the lock and the prompt can never disagree about
// which stage is current, because they read the same one.
export function allowed(met: ReadonlySet<string>): ReadonlySet<Control> | undefined {
  const stage = suggested(met);
  return stage === undefined ? undefined : new Set(stage.allow);
}
