// Wires the model to the picture. Everything the visitor does goes through
// apply(): one world in, one world out, one redraw. There is no other path, so
// the drawing cannot disagree with the model.

import type { World } from "../git/repo.js";
import {
  commitIndex,
  discard,
  edit,
  emptyWorld,
  headOid,
  stage,
  unstage,
} from "../git/repo.js";
import { isClean, statusFor } from "../git/status.js";
import type { Layout } from "../graph/render.js";
import { createGraph } from "../graph/render.js";
import type { Graph } from "../graph/render.js";
import { layout } from "../graph/layout.js";

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

const FILE_IS =
  "A file on your disk. Change it and git notices, but does nothing " +
  "about it until you say so.";

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

  let world = seed();
  // Nothing is open at first: two icons and a gap, so the shape of the thing
  // lands before any git word does.
  const open = new Set<string>();

  const graph: Graph = createGraph(stage_, (name: Layout) =>
    layout(world, open, name),
  );

  const redraw = (): void => {
    graph.setScene((name: Layout) => layout(world, open, name));
  };

  // The accessible mirror of what just happened. Feedback itself lands at the
  // object, inside the picture.
  const say = (text: string): void => {
    if (said !== null) said.textContent = text;
  };

  const suggest = (text: string): void => {
    if (promptLine !== null) promptLine.textContent = text;
  };

  // Changes the world and nothing else, so typing into a file can update the
  // status glyph without the panel being torn out from under the cursor.
  function apply(next: World): void {
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
    text.addEventListener("input", () => {
      apply(edit(world, path, text.value));
    });
    body.append(text);

    const state = statusFor(world, path);
    body.append(
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
      body.append(
        verb("Stage this change", () => {
          const next = stage(world, path);
          graph.sendObject(`file:${path}`, "index", "inside");
          // At the blob it just became, not at the compartment: a note beside
          // the wrong object reads as being about the wrong object.
          act(next, `blob:${next.index[path] ?? ""}`, `Staged ${path}.`);
        }),
      );
    }
    if (state.modified || state.untracked) {
      body.append(
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

  // The index seals into a snapshot, so its inspector is where a commit is
  // made: the verb lives on the thing it acts on, not in a toolbar.
  function inspectIndex(body: HTMLElement): void {
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
    } else {
      const what = WHAT[id];
      if (what !== undefined) body.append(line(what, "what"));
      if (id === "index") inspectIndex(body);
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
  // line happens to be saying.
  function nextPrompt(): void {
    if (!open.has("laptop")) {
      suggest("Open your laptop.");
      return;
    }
    if (!open.has("files")) {
      suggest("Your work is in one of these. Open your files.");
      return;
    }
    if (!open.has("git")) {
      suggest("There is a second database in here. Open .git.");
      return;
    }
    if (!open.has("index")) {
      suggest("One thing left unopened. Open the index.");
      return;
    }
    const dirty = Object.keys(world.working).some(
      (p) => !isClean(statusFor(world, p)),
    );
    if (Object.keys(world.index).length > 0) {
      suggest("The index is holding your change. Open it and commit.");
      return;
    }
    if (dirty) {
      suggest("Git has noticed. Open the file and stage that change.");
      return;
    }
    suggest("Open a file and change a line. Watch what git does.");
  }

  // A closed entity opens; anything else tells you what it is. The first click
  // on the page is therefore never a decision, only a look inside.
  graph.onSelect((id) => {
    if (id in WHAT && !open.has(id)) toggle(id);
    else inspect(id);
  });

  nextPrompt();
}
