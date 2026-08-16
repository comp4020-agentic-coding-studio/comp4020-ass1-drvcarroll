// Wires the model to the picture. Everything the visitor does goes through
// act(): one world in, one world out, one redraw. There is no other path, so
// the drawing cannot disagree with the model.

import type { World } from "../git/repo.js";
import { edit, emptyWorld } from "../git/repo.js";
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

// The project the visitor arrives to. Two files, so "your files" is a place
// with things in it before anything is asked of them.
function seed(): World {
  let world = emptyWorld();
  world = edit(world, "README.md", "# my project\n\nA thing I am making.\n");
  world = edit(world, "main.ts", 'console.log("hello");\n');
  return world;
}

export function start(): void {
  const stage = document.querySelector("[data-graph]");
  if (stage === null || !(stage instanceof HTMLElement)) return;
  const promptLine = document.querySelector("[data-prompt]");
  const said = document.querySelector("[data-said]");

  let world = seed();
  // Nothing is open at first: two icons and a gap, so the shape of the thing
  // lands before any git word does.
  const open = new Set<string>();

  const graph: Graph = createGraph(stage, (name: Layout) =>
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

  function verb(label: string, run: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "verb";
    button.textContent = label;
    button.addEventListener("click", run);
    return button;
  }

  // What this thing is, then what can be done to it. Every verb in the piece
  // lives here rather than in a toolbar, which is what keeps the page from
  // becoming a cockpit as the vocabulary grows.
  function inspect(id: string): void {
    const body = document.createElement("div");
    const what = WHAT[id];
    if (what !== undefined) {
      const p = document.createElement("p");
      p.className = "what";
      p.textContent = what;
      body.append(p);
    }
    if (id in WHAT) {
      body.append(
        verb("Fold this away", () => {
          toggle(id);
        }),
      );
    }
    graph.openInspector(id, id, body);
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
    suggest("This is the whole machine. Open a file to see what is in it.");
  }

  // A closed entity opens; anything else tells you what it is. The first click
  // on the page is therefore never a decision, only a look inside.
  graph.onSelect((id) => {
    if (id in WHAT && !open.has(id)) toggle(id);
    else inspect(id);
  });

  nextPrompt();
}
