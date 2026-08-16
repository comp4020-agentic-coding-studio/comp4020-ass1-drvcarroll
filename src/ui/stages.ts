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
import { ancestry } from "../git/objects.js";
import { isAncestor } from "../git/branch.js";
import { STASH } from "../git/stash.js";
import { startMerge } from "../git/merge.js";
import { canFetch } from "../git/remote.js";
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
  // A function where the instruction has to name a button the visitor named
  // themselves. "Press Merge" is ambiguous the moment two Merge buttons are on
  // screen, and telling someone to press the wrong one is worse than vague.
  readonly prompt: string | ((world: World) => string);
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

// Commits on the line you are standing on. Counting every commit object in the
// store instead counted the teammate's, which a pull puts in .git - so "commit
// a second time" was met by fetching someone else's work and the stage was
// skipped without the visitor having made anything.
function commits(world: World): number {
  const head = headOid(world.local);
  return head === undefined ? 0 : ancestry(world.local.objects, head).length;
}

// The branch the visitor made and named, as opposed to the one they started on.
// The prompts have to say it back to them, because it is half of every button
// label in .git once it exists.
function theirs(world: World): string {
  return local(world).find((n) => n !== "main") ?? "your branch";
}

// Their work is in your .git, which is the only thing a pull actually does and
// the only trace of it a predicate can see. push() never writes origin/*, so
// this can only become true by pressing Pull.
function fetched(world: World): boolean {
  const theirs = headOid(world.remote);
  if (theirs === undefined) return false;
  const name =
    world.remote.head.kind === "branch" ? world.remote.head.name : "main";
  return world.local.refs[`origin/${name}`] === theirs;
}

// Two lines of your own that have both moved since they last agreed. Neither
// containing the other is the whole definition, and it is what replaying and
// merging both need before they have anything to do.
function diverged(world: World): boolean {
  const tips = local(world).map((n) => world.local.refs[n]);
  return tips.some((a) =>
    tips.some(
      (b) =>
        a !== undefined &&
        b !== undefined &&
        a !== b &&
        !isAncestor(world.local.objects, a, b) &&
        !isAncestor(world.local.objects, b, a),
    ),
  );
}

// Both of you changed the same file, so bringing the lines together has a
// question in it that git cannot answer. Asking startMerge is the honest test:
// it is the same code the button runs.
function collides(world: World): boolean {
  return local(world).some(
    (n) => (startMerge(world, n).merging?.conflicts.length ?? 0) > 0,
  );
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
  // Push, a teammate's reply, and the merge that settles it come before
  // branching: collaboration is the reason git exists, and a beginner who has
  // never seen a second person touch the repo has no reason to care what a
  // branch is.
  {
    id: "push",
    teaches: "The server is a different computer, and push is the only way up.",
    prompt: "Nothing has left your machine yet. Press Push.",
    at: "git",
    allow: ["push"],
    met: (world) => headOid(world.remote) !== undefined,
  },
  // This used to be met by the teammate's push rather than by anything the
  // visitor did, so it was already satisfied two seconds after the push above
  // and the prompt vanished before it could be followed - the refusal, which is
  // the entire lesson, was never seen. Pulling is the part the visitor performs,
  // and it is the only thing here that writes origin/main.
  {
    id: "diverged",
    teaches: "A push is refused when the server has work you do not.",
    // Two sentences, because for the couple of seconds before the teammate
    // replies the instruction was describing a push that had not happened and
    // naming a Pull that was correctly dead. An instruction the page cannot
    // yet honour is the same bug as a button that does nothing.
    prompt: (world) =>
      canFetch(world)
        ? "A teammate pushed. Press Push to see it refused, then press Pull."
        : // Says nothing about where your own commit is, because undo can put
          // this stage back in front of a visitor whose push has been taken
          // back - and a prompt that claims a push happened is a bug then.
          "Nothing new from anyone else yet. Give them a moment.",
    at: "git",
    allow: ["push", "pull"],
    met: fetched,
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
    prompt:
      "Click another file, type a change, then press Save and then Commit.",
    at: "files",
    allow: ["files", "save", "commit"],
    met: (world) => commits(world) >= 2,
  },
  {
    id: "merge",
    teaches: "A merge commit has two parents, and that is the whole of it.",
    prompt: "Press Merge origin/main into main, then press Commit.",
    at: "git",
    allow: ["merge", "commit", "files", "save"],
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
    prompt: (world) => `Click the ${theirs(world)} chip to move onto it.`,
    at: "git",
    allow: ["checkout"],
    met: (world) =>
      world.local.head.kind === "branch" && world.local.head.name !== "main",
  },
  {
    id: "stash",
    teaches: "Stash is a commit off to the side, not a special place.",
    prompt: "Click a file, type a change, then press Put aside instead of Save.",
    at: "files",
    allow: ["files", "stash"],
    met: (world) => Object.keys(world.local.refs).includes(STASH),
  },
  // Replaying and colliding both need two lines of work that have moved apart,
  // and "diverge again" was an instruction to reach a state rather than to press
  // anything - the visitor had to already understand rebase to follow the prompt
  // that teaches it. Each is two stages now: one that makes the state with named
  // buttons, one that acts on it. Both stay on your own two branches, because
  // pushing from a branch makes an origin/<branch> whose Replay and Merge
  // buttons read almost identically to main's.
  {
    id: "diverge",
    teaches: "A branch only moves when you commit on it. The other stays put.",
    prompt:
      "Change a file, press Save and Commit. Then click the main chip, " +
      "change a file, and press Save and Commit again.",
    at: "git",
    allow: ["files", "save", "commit", "checkout"],
    met: diverged,
  },
  {
    id: "rebase",
    teaches:
      "Your commits are copied on top of theirs, and the copies get new ids, " +
      "because an id is built from the commit's parent too.",
    prompt: (world) =>
      `Click the ${theirs(world)} chip, then press Replay ${theirs(world)} ` +
      "onto main.",
    at: "git",
    allow: ["checkout", "rebase"],
    met: (world) => unreachable(world).length > 0,
  },
  {
    id: "collide",
    teaches: "Two people changing one file is the whole of what a conflict is.",
    prompt:
      "Change README.md, press Save and Commit. Then click the main chip, " +
      "change README.md again, and press Save and Commit.",
    at: "files",
    allow: ["files", "save", "commit", "checkout"],
    met: collides,
  },
  {
    id: "conflict",
    teaches: "A conflict is a state, resolved with the verbs you already have.",
    prompt: (world) =>
      `Press Merge ${theirs(world)} into main, and read what lands in ` +
      ".git/index.",
    at: "git",
    allow: ["merge"],
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

// The instruction, with the visitor's own branch names in it where the button
// labels have them.
export function promptFor(stage: Stage, world: World): string {
  return typeof stage.prompt === "string" ? stage.prompt : stage.prompt(world);
}

export function suggestion(
  met: ReadonlySet<string>,
  world: World,
): string | undefined {
  const stage = suggested(met);
  return stage === undefined ? undefined : promptFor(stage, world);
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
