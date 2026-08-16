// Wires the model to the picture. Everything the visitor does goes through
// apply(): one world in, one world out, one redraw. There is no other path, so
// the drawing cannot disagree with the model.

import type { World } from "../git/repo.js";
import { readCommit } from "../git/objects.js";
import {
  commitIndex,
  discard,
  edit,
  emptyWorld,
  headOid,
  stage,
  unstage,
} from "../git/repo.js";
import {
  branch,
  canFastForward,
  checkout,
  merge,
  resetBack,
  resetTo,
} from "../git/branch.js";
import { canPush, fetch, push, teammatePushes } from "../git/remote.js";
import { abortMerge, startMerge } from "../git/merge.js";
import { canRebase, rebase, unreachable } from "../git/rebase.js";
import { isClean, status, statusFor } from "../git/status.js";
import { STASH, pop, stash } from "../git/stash.js";
import type { Layout } from "../graph/render.js";
import { createGraph } from "../graph/render.js";
import type { Graph } from "../graph/render.js";
import { layout } from "../graph/layout.js";
import { record, suggested } from "./stages.js";

// One sentence per entity, saying what it is. Naming the components before the
// process is what makes the process legible, and an inspector is the right
// home for it because it costs nothing until it is asked for.
const WHAT: Record<string, string> = {
  laptop:
    "Your computer. Everything below the dotted line is here, on this " +
    "machine, including the whole history of your project.",
  server:
    "Another computer, somewhere else. It holds a copy of the same kind of " +
    "thing .git holds. Only two commands ever reach it: push and fetch.",
  git:
    ".git is a database of snapshots, and it lives in a folder inside your " +
    "project. This is why you can commit on a plane.",
  files:
    "The files you actually edit. Git does not touch these until you tell " +
    "it to, and this is the only place your work exists before you stage it.",
  index:
    "A list of exactly what will go into your next commit. Not a copy of " +
    "your files, just their names and content ids.",
};

// Opening an entity is not progress, so these are not stages. They are the
// order the picture has to be unfolded in before a verb has anything to act on.
const ORIENT: readonly (readonly [string, string])[] = [
  ["laptop", "Open your Local Device."],
  ["files", "Your work is in one of these. Open Your Files."],
  ["git", "There is a second database in here. Open .git."],
  ["index", "One thing left unopened. Open the index."],
];

const FILE_IS =
  "A file on your disk. Change it and git notices, but does nothing " +
  "about it until you say so.";

// What the teammate's commit contains. One line, so the conflict it causes is
// readable in the file rather than something to be taken on trust.
const TEAMMATE = "# my project\n\nEdited by someone else.\n";

const HEAD_IS =
  "Where you are. HEAD names the branch you are on, and that is the branch " +
  "your next commit moves.";

const REF_IS =
  "A branch is a name pointing at one commit. Committing moves the name " +
  "forward; nothing is ever copied, which is why branching is instant.";

const STASH_IS =
  "Work put aside, as a commit that no branch points at. It is not a special " +
  "place: getting it back is just reading that snapshot over your files.";

const COMMIT_IS =
  "A snapshot of every file, named by a hash of its content and its parents. " +
  "Change any of that and it is a different commit, with a different name.";

const BLOB_IS =
  "The content of a file, named by a hash of that content. It is already " +
  "inside .git: staging copied it there, so unstaging loses nothing.";

// The project the visitor arrives to. Two files, so "your files" is a place
// with things in it before anything is asked of them.
function seed(): World {
  let world = emptyWorld();
  world = edit(world, "README.md", "# my project\n\nA thing I am making.\n");
  world = edit(world, "main.ts", 'console.log("hello");\n');
  return world;
}

export function start(): void {
  const stage_ = document.querySelector("[data-graph]");
  if (stage_ === null || !(stage_ instanceof HTMLElement)) return;
  const promptLine = document.querySelector("[data-prompt]");
  const said = document.querySelector("[data-said]");

  // The world the visitor arrived to, kept so "you changed something" can be a
  // comparison of two states rather than a tally of clicks.
  const start_ = seed();
  let world = start_;
  let met: ReadonlySet<string> = new Set();
  // Nothing is open at first: two icons and a gap, so the shape of the thing
  // lands before any git word does.
  const open = new Set<string>();

  const graph: Graph = createGraph(stage_, (name: Layout) =>
    layout(world, open, name),
  );

  // On the picture rather than in the page: every git verb still lives in the
  // inspector of the object it acts on, and this is not a git verb.
  const undoButton = document.createElement("button");
  undoButton.type = "button";
  undoButton.className = "verb take-back";
  undoButton.textContent = "Undo";
  undoButton.disabled = true;
  undoButton.addEventListener("click", () => {
    undo();
  });
  stage_.append(undoButton);

  const redraw = (): void => {
    graph.setScene((name: Layout) => layout(world, open, name));
  };

  // The accessible mirror of what just happened. Feedback itself lands at the
  // object, inside the picture.
  const say = (text: string): void => {
    if (said !== null) said.textContent = text;
  };

  // Said twice, deliberately: once beside the entity it points at, and once in
  // the hidden line a screen reader reads.
  const suggest = (text: string, at?: string): void => {
    if (promptLine !== null) promptLine.textContent = text;
    graph.hint(text, at);
  };

  // Where the visitor was before the last thing they did. The git verbs each
  // keep their own reversal, in git's own vocabulary, because that reversal is
  // a lesson; this is the escape hatch underneath them, and it exists because a
  // visitor who cannot back out stops poking the model.
  interface Moment {
    world: World;
    open: ReadonlySet<string>;
    // Consecutive keystrokes in one file are one thing done, not forty.
    mark?: string;
  }

  const history: Moment[] = [];
  const DEPTH = 50;

  function remember(mark?: string): void {
    const last = history.at(-1);
    if (mark !== undefined && last?.mark === mark) return;
    history.push({ world, open: new Set(open), mark });
    if (history.length > DEPTH) history.shift();
    undoButton.disabled = false;
  }

  function undo(): void {
    const last = history.pop();
    if (last === undefined) return;
    world = last.world;
    open.clear();
    for (const id of last.open) open.add(id);
    undoButton.disabled = history.length === 0;
    graph.closeInspector();
    redraw();
    say("Took that back.");
    nextPrompt();
  }

  // Changes the world and nothing else, so typing into a file can update the
  // status glyph without the panel being torn out from under the cursor.
  function apply(next: World, mark?: string): void {
    remember(mark);
    world = next;
    redraw();
    nextPrompt();
  }

  // A verb: change the world, then say what happened beside the thing it
  // happened to. The live region is the mirror, not the primary channel.
  function act(next: World, at: string, told: string): void {
    apply(next);
    graph.closeInspector();
    graph.annotate(at, told);
    say(told);
  }

  // Opening an entity changes no git state, so it never counts as progress. It
  // gates access instead: you cannot edit a file before you open your files.
  function toggle(id: string): void {
    remember();
    const wasOpen = open.has(id);
    if (wasOpen) open.delete(id);
    else open.add(id);
    // Folding a machine away folds what is inside it, which is what makes
    // collapse a way to get the whole model back on one screen.
    if (id === "laptop" && wasOpen) {
      for (const inner of ["git", "files", "index"]) open.delete(inner);
    }
    graph.closeInspector();
    redraw();
    say(`${id} is ${wasOpen ? "folded away" : "open"}.`);
    nextPrompt();
  }

  function verb(
    label: string,
    run: () => void,
    undo = false,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "verb";
    if (undo) button.dataset["undo"] = "";
    button.textContent = label;
    button.addEventListener("click", run);
    return button;
  }

  function line(text: string, className: string): HTMLParagraphElement {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = text;
    return p;
  }

  // A file: what it is, what is in it, what git currently thinks of it, and
  // the two things you can do about that. Editing writes straight through.
  function inspectFile(path: string, body: HTMLElement): void {
    body.append(line(FILE_IS, "what"));

    const text = document.createElement("textarea");
    text.className = "content";
    text.value = world.working[path] ?? "";
    text.setAttribute("aria-label", `Contents of ${path}`);
    // Everything below the text is rebuilt as you type, and the textarea is
    // not: the verb you need next has to appear the moment it becomes legal,
    // but rebuilding the box you are typing into would take the caret with it.
    const rest = document.createElement("div");
    const refresh = (): void => {
      rest.replaceChildren();
      const state = statusFor(world, path);
      rest.append(
        line(
          state.untracked
            ? "Git has never seen this file."
            : state.modified
              ? "Changed since your last commit."
              : state.staged
                ? "Staged, and ready for the next commit."
                : "Unchanged since your last commit.",
          "state",
        ),
      );
      if (!isClean(state)) {
        rest.append(
          verb("Stage this change", () => {
            const next = stage(world, path);
            graph.sendObject(`file:${path}`, "index", "inside");
            // At the blob it just became, not at the compartment: a note
            // beside the wrong object reads as being about the wrong object.
            act(next, `blob:${next.index[path] ?? ""}`, `Staged ${path}.`);
          }),
        );
      }
      if (state.modified || state.untracked) {
        rest.append(
          verb(
            "Discard my change",
            () => {
              act(
                discard(world, path),
                "files",
                `Discarded your changes to ${path}. That one is gone.`,
              );
            },
            true,
          ),
        );
      }
    };

    text.addEventListener("input", () => {
      apply(edit(world, path, text.value), `edit:${path}`);
      refresh();
    });
    body.append(text, rest);
    refresh();
  }

  // A blob is already inside .git, which is exactly why unstaging is cheap
  // enough to be the first reversal the visitor meets.
  function inspectBlob(oid: string, body: HTMLElement): void {
    const path = Object.keys(world.index).find((p) => world.index[p] === oid);
    body.append(line(BLOB_IS, "what"));
    if (path === undefined) return;
    body.append(
      verb(
        "Unstage this",
        () => {
          act(unstage(world, path), "files", `Unstaged ${path}.`);
        },
        true,
      ),
    );
  }

  // A commit says what it is and what it came from. When nothing points at it
  // any more, it also offers the way back, which is the whole reason a rebase
  // is safe: the old line is still here.
  function inspectCommit(oid: string, body: HTMLElement): void {
    body.append(line(COMMIT_IS, "what"));
    const c = readCommit(world.local.objects, oid);
    if (c === undefined) return;
    const from =
      c.parents.length === 0
        ? "The first commit, so it has no parent."
        : `"${c.message}", on top of ${c.parents.join(" and ")}.`;
    body.append(line(from, "state"));
    if (unreachable(world).includes(oid)) {
      body.append(
        verb(
          "Point this branch back here",
          () => {
            act(resetTo(world, oid), `local:commit:${oid}`, "Back on the old line. The replayed ones are unreachable now.");
          },
          true,
        ),
      );
    }
  }

  // The index seals into a snapshot, so its inspector is where a commit is
  // made: the verb lives on the thing it acts on, not in a toolbar.
  function inspectIndex(body: HTMLElement): void {
    const merging = world.merging;
    if (merging !== undefined) {
      body.append(
        line(
          merging.conflicts.length === 0
            ? `Merging ${merging.name}. Commit to seal it, with two parents.`
            : `Merging ${merging.name}. Resolve the conflict, stage it, then ` +
              "commit. The verbs are the ones you already know.",
          "state",
        ),
      );
      body.append(
        verb(
          "Abandon this merge",
          () => {
            act(abortMerge(world), "index", `Abandoned the merge of ${merging.name}.`);
          },
          true,
        ),
      );
    }
    if (Object.keys(world.index).length === 0) return;
    const message = document.createElement("input");
    message.type = "text";
    message.className = "message";
    message.placeholder = "what this change does";
    message.setAttribute("aria-label", "Commit message");
    body.append(message);
    body.append(
      verb("Commit these changes", () => {
        const text = message.value.trim() || "a change";
        const next = commitIndex(world, text);
        graph.sendObject("index", "git", "inside");
        act(next, `local:commit:${headOid(next.local) ?? ""}`, `Committed: ${text}.`);
      }),
    );
  }

  // A ref chip. Everything offered here is a pointer move, which is the whole
  // reason a branch is worth teaching before a merge is.
  function inspectRef(name: string, body: HTMLElement): void {
    if (name === "HEAD") {
      body.append(line(HEAD_IS, "what"));
      return;
    }
    // A stash is a name for a commit, so it is a chip. It is not a branch you
    // can be on, so the only thing it offers is the way back.
    if (name === STASH) {
      body.append(line(STASH_IS, "what"));
      body.append(
        verb("Get this work back", () => {
          act(pop(world), "files", "Your work is back in your files.");
        }),
      );
      return;
    }
    body.append(line(REF_IS, "what"));
    const head = world.local.head;
    const onIt = head.kind === "branch" && head.name === name;

    if (onIt) {
      const named = document.createElement("input");
      named.type = "text";
      named.className = "message";
      named.placeholder = "new branch name";
      named.setAttribute("aria-label", "New branch name");
      body.append(named);
      body.append(
        verb("Start a branch here", () => {
          const to = named.value.trim() || "feature";
          act(branch(world, to), `local:ref:${to}`, `Started ${to} here.`);
        }),
      );
      for (const other of Object.keys(world.local.refs)) {
        if (other === name || other === STASH) continue;
        if (canFastForward(world, other)) {
          body.append(
            verb(`Merge ${other} into this`, () => {
              act(
                merge(world, other),
                `local:ref:${name}`,
                `Nothing to merge: ${name} moved forward to ${other}.`,
              );
            }),
          );
          continue;
        }
        // The other way through a divergence: say your work again on top of
        // theirs. Offered beside the merge so the choice is the lesson.
        if (canRebase(world, other)) {
          body.append(
            verb(`Replay this onto ${other}`, () => {
              act(
                rebase(world, other),
                `local:ref:${name}`,
                `Same changes, new hashes. The old ones are still in .git.`,
              );
            }),
          );
        }
        // Diverged: a real merge, which may land in a conflicted state. That
        // state is reached by the same button, because it is the same verb.
        const next = startMerge(world, other);
        if (next === world) continue;
        body.append(
          verb(`Merge ${other} into this`, () => {
            const conflicts = next.merging?.conflicts ?? [];
            act(
              next,
              conflicts.length === 0 ? `local:ref:${name}` : `file:${conflicts[0] ?? ""}`,
              conflicts.length === 0
                ? `Merged ${other}. Commit it to seal the two parents.`
                : `${String(conflicts.length)} file both of you changed. Open it.`,
            );
          }),
        );
      }
      if (headOid(world.local) !== undefined) {
        body.append(
          verb(
            "Move the branch back",
            () => {
              act(
                resetBack(world),
                `local:ref:${name}`,
                `Moved ${name} back. The commit is still in .git.`,
              );
            },
            true,
          ),
        );
      }
      return;
    }

    body.append(
      verb("Check out this branch", () => {
        const next = checkout(world, name);
        if (next === world) {
          say("Not while you have unsaved changes. Commit them, or put them aside.");
          return;
        }
        act(next, `local:ref:${name}`, `On ${name}. Your files changed to match.`);
      }),
    );
  }

  // The other machine. Only two verbs reach it, and they are the only two in
  // the whole piece that cross the gap.
  function inspectServer(body: HTMLElement): void {
    if (headOid(world.local) !== undefined) {
      body.append(
        verb("Push to the server", () => {
          if (!canPush(world)) {
            // The refusal is the lesson, so it is explained rather than
            // prevented: a greyed-out button teaches nothing.
            act(
              world,
              "server",
              "Refused: the server has a commit you do not. Fetch first.",
            );
            return;
          }
          graph.sendObject("git", "server", "network");
          act(push(world), "server", "Pushed. The server has the same commits.");
        }),
      );
    }
    body.append(
      verb("A teammate pushes a change", () => {
        act(
          teammatePushes(world, "README.md", TEAMMATE, "their change"),
          "server",
          "Someone else pushed while you were working.",
        );
      }),
    );
    if (headOid(world.remote) !== undefined) {
      body.append(
        verb("Fetch from the server", () => {
          graph.sendObject("server", "git", "network");
          act(fetch(world), "git", "Fetched. Your files have not changed.");
        }),
      );
    }
  }

  // What this thing is, then what can be done to it. Every verb in the piece
  // lives here rather than in a toolbar, which is what keeps the page from
  // becoming a cockpit as the vocabulary grows.
  function inspect(id: string): void {
    const body = document.createElement("div");
    let title = id;

    if (id.startsWith("file:")) {
      title = id.slice(5);
      inspectFile(title, body);
    } else if (id.startsWith("blob:")) {
      title = id.slice(5);
      inspectBlob(title, body);
    } else if (id.startsWith("local:commit:")) {
      title = id.slice(13);
      inspectCommit(title, body);
    } else if (id.startsWith("local:ref:")) {
      title = id.slice(10);
      inspectRef(title, body);
    } else {
      const what = WHAT[id];
      if (what !== undefined) body.append(line(what, "what"));
      if (id === "index") inspectIndex(body);
      if (id === "server") inspectServer(body);
      // Only once there is a commit to come back to. Before that there is no
      // wall to be stuck at, and the verb would be a control looking for a job.
      if (
        id === "files" &&
        headOid(world.local) !== undefined &&
        !status(world).every(isClean)
      ) {
        body.append(
          verb("Put this work aside", () => {
            act(
              stash(world),
              `local:ref:${STASH}`,
              "Your work is a commit off to the side. Your files are clean.",
            );
          }),
        );
      }
      if (id === "laptop") {
        body.append(
          verb(
            "Start over",
            () => {
              world = start_;
              open.clear();
              act(world, "laptop", "Back to the beginning.");
            },
            true,
          ),
        );
      }
      if (id in WHAT) {
        body.append(
          verb("Fold this away", () => {
            toggle(id);
          }),
        );
      }
    }
    graph.openInspector(id, title, body);
  }

  // Suggests, never gates. Every legal action stays available whatever this
  // line happens to be saying. Orientation comes first because a git verb is
  // unreachable while the thing it acts on is still folded away; after that
  // the curriculum drives, and it retires when there is nothing left to show.
  function nextPrompt(): void {
    met = record(met, world, start_);
    for (const [id, ask] of ORIENT) {
      if (!open.has(id)) {
        suggest(ask, id);
        return;
      }
    }
    const next = suggested(met);
    suggest(next?.prompt ?? "", next?.at);
  }

  // A closed entity opens; anything else tells you what it is. The first click
  // on the page is therefore never a decision, only a look inside.
  graph.onSelect((id) => {
    if (id in WHAT && !open.has(id)) toggle(id);
    else inspect(id);
  });

  // The same call the inspector's verb makes, so there is one way to stage and
  // the drag is an enhancement over it rather than a second implementation.
  graph.onDrop((from, to) => {
    if (!from.startsWith("file:") || to !== "index") return;
    const path = from.slice(5);
    if (isClean(statusFor(world, path))) return;
    const next = stage(world, path);
    graph.sendObject(from, "index", "inside");
    act(next, `blob:${next.index[path] ?? ""}`, `Staged ${path}.`);
  });

  nextPrompt();
}
