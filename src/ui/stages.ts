// The curriculum: three runs through git, walked in order and then repeated.
//
// A run is a fixed sequence of steps, and a step is an instruction, an
// explanation, and a predicate saying whether the world now shows the thing
// the step asked for. The page walks the visitor through run one, then two,
// then three, and then starts again at one.
//
// Two rules make the walk deterministic, and both matter:
//
// 1. A step's predicate compares the world against `entry` - the world as it
//    was when that step became the current one - never against an absolute.
//    "You made a commit" has to stay answerable on the fourth time round,
//    when there are already a dozen commits in .git.
// 2. The runs chain rather than reset. Run one leaves the teammate's work
//    fetched but unmerged, which is the refused push run two opens on; run
//    two leaves you level with the server, which is the clean base run three
//    branches from; run three leaves your line ahead, which is what run one
//    pushes next time round. Nothing is ever wiped to make a run start.
//
// Nothing here can see the interface. A step names the controls it needs and
// the page locks the rest, which is what keeps the walk unbreakable, but the
// locking happens one layer up where it can change without touching this.

import type { World } from "../git/repo.js";
import { headOid } from "../git/repo.js";
import { STASH } from "../git/stash.js";
import { canFetch } from "../git/remote.js";

// Every control the page can offer, named once so a step can say which of them
// its instruction is about. The page tags each button with one of these and
// locks everything the current step did not name.
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

// Everything a step is allowed to know. Three worlds rather than one, because
// the questions a step asks are relative: "since this step began" needs entry,
// and "the branch you made earlier in this run" needs runEntry.
export interface Ctx {
  readonly world: World;
  readonly entry: World; // when this step became current
  readonly runEntry: World; // when this run became current
  // Things the page saw happen that leave no trace in the world. Exactly one
  // step needs this - a refused push changes nothing, and being refused is the
  // whole lesson of it - so it stays a narrow escape hatch rather than a
  // second source of truth.
  readonly seen: ReadonlySet<string>;
}

export interface Step {
  readonly id: string;
  // What to do. A function where the instruction has to name something the
  // visitor named themselves, because "press Merge" is ambiguous the moment
  // two Merge buttons are on screen.
  readonly say: string | ((c: Ctx) => string);
  // Why it is worth doing. This is the piece, not a footnote to it: an
  // explainer that only ever says "press this" has explained nothing.
  readonly why: string | ((c: Ctx) => string);
  // The entity the instruction is about, so it can be drawn beside it.
  readonly at: string;
  // What the visitor may touch while this step is current. It must cover every
  // control the instruction needs, including the ones only used to set up the
  // state it asks for: a step that locks away part of its own path is a dead
  // end, which is the one failure worse than an unlocked page.
  readonly allow: readonly Control[];
  done(c: Ctx): boolean;
}

export interface Run {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly Step[];
}

// Where the walk is. Two numbers, so it survives being written down and read
// back, and so a test can assert the exact place the visitor ended up.
export interface Cursor {
  readonly run: number;
  readonly step: number;
}

// ---- what the predicates ask ----

// Branches you made: not the remote-tracking names fetch writes for you, and
// not the stash, which is a name for a commit but never a branch you are on.
function local(world: World): string[] {
  return Object.keys(world.local.refs).filter(
    (n) => !n.startsWith("origin/") && n !== STASH,
  );
}

// A commit landed on the line you are standing on. Comparing HEAD against the
// step's own starting point, so this stays true on the tenth commit as much as
// the first.
function committed(c: Ctx): boolean {
  return headOid(c.world.local) !== headOid(c.entry.local);
}

// Merge commits are counted rather than detected, because a step that asks for
// one has to stay satisfied after the next step has moved on: "did a merge
// happen" must not become false again the moment `merging` is cleared.
function mergeCommits(world: World): number {
  return Object.values(world.local.objects).filter(
    (o) => o.kind === "commit" && o.parents.length >= 2,
  ).length;
}

function merged(c: Ctx): boolean {
  return mergeCommits(c.world) > mergeCommits(c.entry);
}

// The branch made earlier in this run, which is the one every later step of
// run three has to name back to the visitor. Measured from the run's start,
// not the step's, because by the time we need the name several steps have been
// and gone - and it is deliberately the newest, so a second time round the
// walk names the branch just made rather than the one from last cycle.
function newBranch(c: Ctx): string {
  const before = new Set(local(c.runEntry));
  const made = local(c.world).filter((n) => !before.has(n));
  return made[made.length - 1] ?? "your branch";
}

// Their work is in your .git, which is the only thing a pull actually does and
// the only trace of it a predicate can see. push() never writes origin/*, so
// this can only become true by pressing Pull.
function pulled(c: Ctx): boolean {
  const name =
    c.world.remote.head.kind === "branch" ? c.world.remote.head.name : "main";
  const now = c.world.local.refs[`origin/${name}`];
  return now !== undefined && now !== c.entry.local.refs[`origin/${name}`];
}

// ---- the three runs ----

export const RUNS: readonly Run[] = [
  {
    id: "share",
    title: "Making a change and sharing it",
    steps: [
      {
        id: "edit",
        say: "Click README.md in the list, then type anything you like into the editor.",
        why:
          "Ordinary files on your own disk. Git is not watching them yet: " +
          "nothing is recorded, and nothing has left your computer.",
        at: "files",
        allow: ["files"],
        done: (c) =>
          JSON.stringify(c.world.working) !== JSON.stringify(c.entry.working),
      },
      {
        id: "save",
        say: "Press Save.",
        why:
          "Git copies the contents into .git and writes the name into the " +
          "index: the list of exactly what your next commit will contain.",
        at: "files",
        allow: ["files", "save"],
        done: (c) =>
          JSON.stringify(c.world.index) !== JSON.stringify(c.entry.index),
      },
      {
        id: "commit",
        say: "Type a short message saying what you changed, then press Commit.",
        why:
          "A commit seals the index into a snapshot, named by an id built " +
          "from its contents and its parent. It lives in .git, on your " +
          "machine.",
        at: "index",
        allow: ["files", "save", "commit"],
        done: committed,
      },
      {
        id: "push",
        say: "Press Push.",
        why:
          "One of only two commands that ever reach the server. Everything " +
          "you did before this line happened on your computer alone.",
        at: "git",
        allow: ["push"],
        done: (c) => headOid(c.world.remote) !== headOid(c.entry.remote),
      },
      {
        id: "arrives",
        say: "Someone else works on this project too. Give them a moment.",
        why:
          "The server is a different computer, and other people push to it. " +
          "That is why it can hold work your .git has never seen.",
        at: "server",
        allow: [],
        done: (c) => canFetch(c.world),
      },
      {
        id: "pull",
        say: "Press Pull.",
        why:
          "Their commits come into your .git and origin/main moves. Look at " +
          "Your Files: nothing there changed, because fetching does not touch " +
          "what you edit.",
        at: "git",
        allow: ["pull"],
        done: pulled,
      },
    ],
  },
  {
    id: "merge",
    title: "When two people change one project",
    steps: [
      {
        id: "yours",
        say: "Click notes.md, type a change, press Save, then press Commit.",
        why:
          "You and your teammate have both moved on from the same commit. Two " +
          "lines of history now, and neither one contains the other.",
        at: "files",
        allow: ["files", "save", "commit"],
        done: committed,
      },
      {
        id: "refused",
        say: "Press Push, and read what comes back.",
        why:
          "The server holds a commit you do not have, and git will never let " +
          "a push throw away someone else's work. Bring theirs in first.",
        at: "git",
        allow: ["push"],
        // Refused is what this step is for and what run one guarantees. The
        // second half is a trapdoor, not a second lesson: if the push ever did
        // go through, Push is the only control this step unlocks and pressing
        // it again says "nothing to push", so without this the walk would
        // stall here with no way forward at all. A step that cannot be
        // completed is worse than a step that taught nothing.
        done: (c) =>
          c.seen.has("push:refused") ||
          headOid(c.world.remote) !== headOid(c.entry.remote),
      },
      {
        id: "combine",
        say: "Press Merge origin/main into main.",
        why:
          "A merge compares three snapshots: what you both started from, " +
          "yours, and theirs. Where only one side changed a file, git takes " +
          "it.",
        at: "git",
        allow: ["merge"],
        done: (c) => c.world.merging !== undefined || merged(c),
      },
      {
        id: "seal",
        say: "Press Commit to seal the merge.",
        why:
          "A merge commit has two parents: one commit pointing back at both " +
          "lines, so nothing was overwritten and nothing was lost.",
        at: "index",
        allow: ["merge", "commit"],
        done: merged,
      },
      {
        id: "share",
        say: "Press Push again.",
        why:
          "Accepted this time. Your line now contains theirs, so there is " +
          "nothing on the server that your push would overwrite.",
        at: "git",
        allow: ["push"],
        done: (c) => headOid(c.world.remote) !== headOid(c.entry.remote),
      },
    ],
  },
  {
    id: "branch",
    title: "Working on a branch",
    steps: [
      {
        id: "start",
        say: "Press Branch, type a name for it, then press Start a branch here.",
        why:
          "A branch is a name pointing at a commit. Starting one copies " +
          "nothing and creates no snapshot: it writes one line into .git.",
        at: "git",
        allow: ["branch"],
        done: (c) => local(c.world).length > local(c.entry).length,
      },
      {
        id: "move",
        say: (c) => `Click the ${newBranch(c)} chip to move onto it.`,
        why:
          "HEAD marks where you are standing. Checking out moves it and " +
          "writes that commit's snapshot back over your files.",
        at: "git",
        allow: ["checkout"],
        done: (c) =>
          c.world.local.head.kind === "branch" &&
          c.entry.local.head.kind === "branch" &&
          c.world.local.head.name !== c.entry.local.head.name,
      },
      {
        id: "work",
        say: "Click main.ts, type a change, press Save, then press Commit.",
        why: (c) =>
          `The commit lands on ${newBranch(c)} and moves only that name. ` +
          "main has not moved at all: two names, two commits.",
        at: "files",
        allow: ["files", "save", "commit"],
        done: committed,
      },
      {
        id: "back",
        say: "Click the main chip to go back to main.",
        why:
          "Your files change back to what main says. Your branch's commit is " +
          "still in .git, exactly where you left it.",
        at: "git",
        allow: ["checkout"],
        // Standing on main, having not been standing on main when this step
        // began. Comparing HEAD's commit instead would be wrong the moment
        // the two branches happen to point at the same one.
        done: (c) =>
          c.world.local.head.kind === "branch" &&
          c.world.local.head.name === "main" &&
          !(
            c.entry.local.head.kind === "branch" &&
            c.entry.local.head.name === "main"
          ),
      },
      {
        id: "diverge",
        say: "Click styles.css, type a change, press Save, then press Commit.",
        why:
          "Both lines have moved since they split. The same shape as run two, " +
          "except this time both lines are yours.",
        at: "files",
        allow: ["files", "save", "commit"],
        done: committed,
      },
      {
        id: "combine",
        say: (c) => `Press Merge ${newBranch(c)} into main.`,
        why:
          "The same three-snapshot comparison: what the two branches last " +
          "agreed on, what main did, what your branch did.",
        at: "git",
        allow: ["merge"],
        done: (c) => c.world.merging !== undefined || merged(c),
      },
      {
        id: "seal",
        say: "Press Commit.",
        why:
          "One commit, two parents, both lines kept. A merge is the same " +
          "mechanism whether the other side was a teammate or you.",
        at: "index",
        allow: ["merge", "commit"],
        done: merged,
      },
    ],
  },
];

// ---- walking it ----

export const START: Cursor = { run: 0, step: 0 };

export function runAt(cursor: Cursor): Run | undefined {
  return RUNS[cursor.run];
}

export function stepAt(cursor: Cursor): Step | undefined {
  return runAt(cursor)?.steps[cursor.step];
}

// The next place, wrapping past the last run back to the first. The walk never
// ends: three runs is the whole curriculum and it repeats, so there is no
// terminal state to special-case.
export function nextCursor(cursor: Cursor): Cursor {
  const run = RUNS[cursor.run];
  if (run !== undefined && cursor.step + 1 < run.steps.length) {
    return { run: cursor.run, step: cursor.step + 1 };
  }
  return { run: (cursor.run + 1) % RUNS.length, step: 0 };
}

export function sayFor(step: Step, c: Ctx): string {
  return typeof step.say === "string" ? step.say : step.say(c);
}

export function whyFor(step: Step, c: Ctx): string {
  return typeof step.why === "string" ? step.why : step.why(c);
}

// What the visitor may touch. Never undefined: the walk always has a current
// step, so there is always an answer, and the page never has to guess.
export function allowed(cursor: Cursor): ReadonlySet<Control> {
  return new Set(stepAt(cursor)?.allow ?? []);
}

