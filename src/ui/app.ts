// Wires the model to the picture. Everything the visitor does goes through
// apply(): one world in, one world out, one redraw. There is no other path, so
// the drawing cannot disagree with the model.
//
// The picture is four permanently-open panels, stacked in the order a change
// travels: Your Files, .git/index, .git, and the Git Server, with an arrow
// between each pair. Nothing here toggles open or closed any more, and nothing
// lives behind a popup on a pointer that can hover - the one sentence each
// panel earns is drawn beside it, shown on hover, and on touch by a tap that
// opens a small dismissible note instead.

import type { World } from "../git/repo.js";
import { ancestry } from "../git/objects.js";
import {
  commitIndex,
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
import {
  canFetch,
  canPush,
  entriesAt,
  fetch,
  push,
  teammatePushes,
} from "../git/remote.js";
import { abortMerge, startMerge } from "../git/merge.js";
import { canRebase, rebase, unreachable } from "../git/rebase.js";
import { glyphFor, isClean, status, statusFor } from "../git/status.js";
import { STASH, pop, stash } from "../git/stash.js";
import { hueFor } from "../git/hash.js";
import { durationFor } from "./motion.js";
import type { Control, Ctx, Cursor } from "./stages.js";
import {
  RUNS,
  START,
  allowed,
  nextCursor,
  runAt,
  sayFor,
  stepAt,
  whyFor,
} from "./stages.js";

// One sentence per panel, said beside it on hover and read out the moment the
// visitor's attention (or a screen reader) lands there.
const WHAT: Record<string, string> = {
  git:
    ".git is a database of snapshots, and it lives in a folder inside your " +
    "project. This is why you can commit on a plane.",
  files:
    "The files you actually edit. Git does not touch these until you stage " +
    "them, and this is the only place your work exists before then.",
  index:
    "A list of exactly what will go into your next commit. Not a copy of " +
    "your files, just their names and content ids.",
  server:
    "Another computer, somewhere else. It holds a copy of the same kind of " +
    "thing .git holds. Only two commands ever reach it: push and fetch.",
};

const PANEL_TITLE: Record<string, string> = {
  server: "Git Server",
  git: ".git",
  index: ".git/index",
  files: "Your Files",
};

// Top to bottom, matching the direction a change travels: out of your files,
// into the index, into .git, and only then across the network gap.
const PANEL_ORDER = ["server", "git", "index", "files"] as const;

// The order the tour introduces the entities, bottom to top: the direction a
// change actually travels, and the direction the arrows already point.
const TOUR_ORDER = ["files", "index", "git", "server"] as const;

// Enough files that the list reads like a project rather than a fixture, and
// enough that it has something to scroll.
function seed(): World {
  let world = emptyWorld();
  world = edit(world, "README.md", "# my project\n\nA thing I am making.\n");
  world = edit(world, "main.ts", 'console.log("hello");\n');
  world = edit(world, "styles.css", "body {\n  margin: 0;\n}\n");
  world = edit(world, "notes.md", "- remember to write tests\n");
  world = edit(world, "package.json", '{\n  "name": "my-project"\n}\n');
  return world;
}

export function start(): void {
  const stageEl = document.querySelector("[data-graph]");
  if (stageEl === null || !(stageEl instanceof HTMLElement)) return;
  const stage_: HTMLElement = stageEl;
  const promptLine = document.querySelector("[data-prompt]");
  const hintWhere = document.querySelector("[data-hint-where]");
  const hintDo = document.querySelector("[data-hint-do]");
  const hintWhy = document.querySelector("[data-hint-why]");
  const said = document.querySelector("[data-said]");

  let world = seed();
  let selectedFile: string | undefined;
  let draft = ""; // a half-typed commit message
  let branchName = ""; // a half-typed new branch name

  // The walk. `cursor` is which run and step; `entry` and `runEntry` are the
  // worlds those began in, which is what lets a step's question be "since you
  // were told to do this" rather than an absolute the second cycle would
  // already satisfy. `seen` carries the one thing a world cannot record: that
  // a push came back refused.
  let cursor: Cursor = START;
  let entry: World = world;
  let runEntry: World = world;
  let seen = new Set<string>();

  const ctx = (): Ctx => ({ world, entry, runEntry, seen });

  // The one question the drawing asks the walk. A verb that only one run ever
  // needs is drawn only while that run needs it - so Branch is not sitting on
  // screen through the whole of run one being something you must not press.
  // The core verbs stay drawn and merely go dead, because a beginner should be
  // able to see what the four entities can do before they are asked to do it.
  const allows = (control: Control): boolean =>
    phase === "runs" && allowed(cursor).has(control);

  // The tour names the four entities before any git verb exists. After it, the
  // runs take over and never stop: three of them, walked in order, then again.
  type Phase = "tour" | "runs";
  let phase: Phase = "tour";
  let shown = 0; // how many entities the tour has revealed
  let naming = false; // whether the new-branch field is showing

  stage_.replaceChildren();

  const undoButton = document.createElement("button");
  undoButton.type = "button";
  undoButton.className = "verb take-back";
  undoButton.textContent = "Undo";
  undoButton.disabled = true;
  undoButton.addEventListener("click", () => {
    undo();
  });
  document.body.append(undoButton);

  // The tour's one control. It advances nothing in the model - it only names the
  // next entity - and it is gone the moment the last one has been named. It
  // lives at the end of the sentence it continues, rather than floating over the
  // picture: read what this entity is, then ask for the next one.
  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "verb go-on";
  nextButton.textContent = "Next";
  nextButton.addEventListener("click", () => {
    reveal();
  });
  promptLine?.append(nextButton);

  // One panel per entity, in reading order, each holding its own body and its
  // own hover/tap description - never a shared lane beside the picture.
  const panels = new Map<string, HTMLElement>();
  const bodies = new Map<string, HTMLElement>();
  const actions = new Map<string, HTMLElement>();

  // Width, not pointer type. The marking viewport is a 390px-wide Chrome window
  // on a desktop, which reports a fine pointer and hover - so gating the narrow
  // layout on `pointer: coarse` left that visitor with the gutters, the hover
  // notes and none of the taps. One query, matching the stylesheet's own
  // breakpoint, decides both halves.
  const narrow = window.matchMedia("(max-width: 700px)");
  // The prompt's home when there is no gutter to put it in: a bar across the
  // top of the screen, above the picture rather than inside one panel of it.
  const screenEl = promptLine?.parentElement ?? null;

  function makePanel(id: string): HTMLElement {
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.dataset["panel"] = id;
    // Hidden until the tour names it, but still holding its share of the
    // height: the four divide one viewport, so dropping one out of layout would
    // shift the other three on every press.
    panel.dataset["revealed"] = "false";
    // The entity names itself, and its verbs sit on the opposite end of the
    // same line: what this is, and what can be done to it, side by side.
    const head = document.createElement("header");
    head.className = "panel-head";
    const heading = document.createElement("h2");
    heading.textContent = PANEL_TITLE[id] ?? id;
    const verbs = document.createElement("div");
    verbs.className = "panel-actions";
    head.append(heading, verbs);
    const body = document.createElement("div");
    body.className = "panel-body";
    panel.append(head, body);
    const what = WHAT[id];
    if (what !== undefined) {
      // Both paths are built once and the width picks between them live, so a
      // resize across the breakpoint never leaves a panel with no way to say
      // what it is. Wide: a note in the gutter on hover. Narrow: a tap.
      const desc = document.createElement("p");
      desc.className = "desc";
      desc.textContent = what;
      panel.append(desc);
      panel.addEventListener("click", (event) => {
        if (!narrow.matches) return;
        const target = event.target as HTMLElement;
        if (target.closest("button, input, select, textarea, li")) return;
        showTouchNote(id, what);
      });
    }
    panels.set(id, panel);
    bodies.set(id, body);
    actions.set(id, verbs);
    return panel;
  }

  let touchNote: HTMLElement | undefined;
  function closeTouchNote(): void {
    touchNote?.remove();
    touchNote = undefined;
  }
  function showTouchNote(at: string, text: string): void {
    closeTouchNote();
    const note = document.createElement("div");
    note.className = "inspector touch-note";
    const header = document.createElement("header");
    const heading = document.createElement("h3");
    heading.textContent = PANEL_TITLE[at] ?? at;
    const shut = document.createElement("button");
    shut.type = "button";
    shut.className = "inspector-close";
    shut.setAttribute("aria-label", "Close");
    shut.textContent = "×";
    shut.addEventListener("click", () => {
      closeTouchNote();
    });
    header.append(heading, shut);
    const body = document.createElement("p");
    body.className = "what";
    body.textContent = text;
    note.append(header, body);
    stage_.append(note);
    touchNote = note;
  }
  stage_.addEventListener("click", (event) => {
    if (touchNote === undefined) return;
    if (touchNote.contains(event.target as Node)) return;
    closeTouchNote();
  });

  // An arrow describes a relationship between two entities, so it waits for both
  // of them: during the tour it would otherwise point at something unnamed.
  const arrows: { el: HTMLElement; from: string; to: string }[] = [];

  for (const [i, id] of PANEL_ORDER.entries()) {
    stage_.append(makePanel(id));
    const to = PANEL_ORDER[i + 1];
    if (to !== undefined) {
      const arrow = document.createElement("div");
      arrow.className = "arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.dataset["arrow"] = `${id}:${to}`;
      arrow.textContent = "↕";
      arrow.hidden = true;
      stage_.append(arrow);
      arrows.push({ el: arrow, from: id, to });
    }
  }

  const isRevealed = (id: string): boolean =>
    panels.get(id)?.dataset["revealed"] === "true";

  function drawArrows(): void {
    for (const { el, from, to } of arrows) {
      el.hidden = !isRevealed(from) || !isRevealed(to);
    }
  }

  // The people you are not. Two of them so "a teammate pushes" reads as a team
  // rather than one scripted rival, standing outside the server's left border
  // because neither is part of your machine and never was. They take turns -
  // one push per turn, in the same top-to-bottom order they are drawn in -
  // rather than both replying at once, which is what keeps "your next push is
  // refused" a single clear lesson instead of a pile-up.
  const TEAMMATE_NAMES = ["Bonnie", "Clyde"] as const;

  function makeActor(name: string, index: number): HTMLElement {
    const actor = document.createElement("div");
    actor.className = "actor";
    actor.dataset["actor"] = name.toLowerCase();
    actor.style.setProperty("--actor-index", String(index));
    actor.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="8" r="4" />' +
      '<path d="M4 22a8 8 0 0 1 16 0z" />' +
      "</svg>";
    const label = document.createElement("p");
    label.className = "actor-name";
    label.textContent = name;
    actor.append(label);
    panels.get("server")?.append(actor);
    return actor;
  }

  const teammates = TEAMMATE_NAMES.map((name, index) => ({
    name,
    el: makeActor(name, index),
  }));
  // Registered as flight endpoints so a commit can be seen leaving whichever
  // teammate sent it. The same map sendObject already reads, rather than a
  // second one beside it.
  for (const mate of teammates) bodies.set(`teammate:${mate.name}`, mate.el);
  let teammateTurn = 0;

  let replyTimer: number | undefined;
  function forgetReply(): void {
    if (replyTimer !== undefined) clearTimeout(replyTimer);
    replyTimer = undefined;
  }

  const lineFor = (name: string): string => `hi, my name is ${name.toLowerCase()}!\n`;

  // Whichever file your last commit actually changed: the teammate adds their
  // line to that one, so their work lands on the file you care about and
  // collides properly if you touch it again. Nothing invented, nothing
  // special-cased to README.
  function teammateTarget(
    w: World,
    name: string,
  ): { path: string; text: string } | undefined {
    const head = headOid(w.remote);
    if (head === undefined) return undefined;
    const c = w.remote.objects[head];
    if (c?.kind !== "commit") return undefined;
    const now = entriesAt(w.remote, head);
    const before = entriesAt(w.remote, c.parents[0]);
    const touched = Object.keys(now).filter((p) => now[p] !== before[p]).sort();
    const path = touched[0] ?? Object.keys(now).sort()[0];
    if (path === undefined) return undefined;
    const oid = now[path];
    const held = oid === undefined ? undefined : w.remote.objects[oid];
    const text = (held?.kind === "blob" ? held.text : "") + lineFor(name);
    return { path, text };
  }

  // Two seconds after every push of yours, not once: the refusal it causes is
  // the lesson, and a lesson you meet once is a cutscene. Only the next
  // teammate in line replies - never both at once.
  function teammateReplies(): void {
    forgetReply();
    const wait = durationFor("network") === 0 ? 0 : 2000;
    replyTimer = window.setTimeout(() => {
      replyTimer = undefined;
      const mate = teammates[teammateTurn % teammates.length];
      if (mate === undefined) return;
      const target = teammateTarget(world, mate.name);
      if (target === undefined) return;
      teammateTurn += 1;
      mate.el.dataset["acting"] = "true";
      setTimeout(() => delete mate.el.dataset["acting"], durationFor("network"));
      sendObject(`teammate:${mate.name}`, "server", "network");
      act(
        teammatePushes(
          world,
          target.path,
          target.text,
          `hi from ${mate.name.toLowerCase()}`,
        ),
        "server",
        `${mate.name} pushed a change to ${target.path}. Your next push ` +
          "will be refused, because the server now holds work you do not.",
      );
    }, wait);
  }

  // .git/index: Commit, in its header, the same corner Files keeps Save in. It
  // replaces the old stage-then-commit flow's second half entirely - staging
  // now happens on Save.
  const commitButton = document.createElement("button");
  commitButton.type = "button";
  commitButton.className = "panel-action";
  commitButton.dataset["control"] = "commit";
  commitButton.textContent = "Commit";
  commitButton.addEventListener("click", () => {
    if (Object.keys(world.index).length === 0) return;
    const text = draft.trim() || "a change";
    const next = commitIndex(world, text);
    if (next === world) {
      say("Still conflicted. Resolve it in Your Files, then Save, then Commit.");
      return;
    }
    draft = "";
    sendObject("index", "git", "inside");
    act(next, "git", `Committed: ${text}.`);
  });
  actions.get("index")?.append(commitButton);

  // .git: Push and Pull, in its header. Pull is exactly a fetch, and it is dead
  // until a teammate has actually pushed - pressing it any other time taught
  // the beginner that Pull is just a button you press after Push.
  const pullButton = document.createElement("button");
  pullButton.type = "button";
  pullButton.className = "panel-action";
  pullButton.dataset["control"] = "pull";
  pullButton.textContent = "Pull";
  pullButton.addEventListener("click", () => {
    if (!canFetch(world)) return;
    sendObject("server", "git", "network");
    act(fetch(world), "git", "Fetched. Your files have not changed.");
  });
  const pushButton = document.createElement("button");
  pushButton.type = "button";
  pushButton.className = "panel-action";
  pushButton.dataset["control"] = "push";
  pushButton.textContent = "Push";
  pushButton.addEventListener("click", () => {
    if (headOid(world.local) === undefined) return;
    // Whether a teammate answers this one. Read before the push, because act()
    // moves the walk on and the step that wanted the answer would be gone.
    // Only run one's push is answered: that run is where the whole point is
    // somebody else's work arriving, and a reply on any other push would put
    // the server ahead in the middle of a run that never asked it to be.
    const answered = runAt(cursor)?.id === "share" && stepAt(cursor)?.id === "push";
    if (!canPush(world)) {
      // Two different refusals, and telling a beginner the wrong one teaches
      // them to pull when there was never anything to pull.
      const level = headOid(world.remote) === headOid(world.local);
      // The refusal leaves no mark on the world, and being refused is the
      // whole lesson of one step, so the page has to remember it happened.
      if (!level) seen.add("push:refused");
      act(
        world,
        "server",
        level
          ? "Nothing to push: the server already has every commit you have."
          : "Refused: the server has a commit you do not. Pull first.",
      );
      return;
    }
    sendObject("git", "server", "network");
    act(push(world), "server", "Pushed. The server has the same commits.");
    if (answered) teammateReplies();
  });
  // .git: Branch, beside Push and Pull, and shown only by the step that asks
  // for it. One button that asks for a name when pressed, rather than an input
  // and a verb standing open forever waiting to be needed.
  const branchButton = document.createElement("button");
  branchButton.type = "button";
  branchButton.className = "panel-action";
  branchButton.dataset["control"] = "branch";
  branchButton.textContent = "Branch";
  branchButton.addEventListener("click", () => {
    naming = !naming;
    redraw();
  });
  actions.get("git")?.append(pullButton, pushButton, branchButton);

  // Your Files: Save, in its header. Saving is what stages the edit - the one
  // place the old "stage this change" verb now lives.
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "panel-action";
  saveButton.dataset["control"] = "save";
  saveButton.textContent = "Save";
  saveButton.addEventListener("click", () => {
    if (selectedFile === undefined) return;
    if (isClean(statusFor(world, selectedFile))) return;
    const next = stage(world, selectedFile);
    sendObject("files", "index", "inside");
    act(next, "index", `Staged ${selectedFile}.`);
  });
  // The stash pair belongs here rather than in .git, because here is where you
  // can see it work: your files go clean, and then they come back.
  const stashButton = document.createElement("button");
  stashButton.type = "button";
  stashButton.className = "panel-action";
  stashButton.dataset["control"] = "stash";
  stashButton.textContent = "Put aside";
  stashButton.addEventListener("click", () => {
    act(
      stash(world),
      "files",
      "Your work is a commit off to the side. Your files are clean.",
    );
  });
  const popButton = document.createElement("button");
  popButton.type = "button";
  popButton.className = "panel-action";
  popButton.dataset["control"] = "stash";
  popButton.textContent = "Bring it back";
  popButton.addEventListener("click", () => {
    const next = pop(world);
    if (next === world) {
      say("Not while you have unsaved changes. Commit them, or save them first.");
      return;
    }
    act(next, "files", "Your work is back in your files.");
  });
  actions.get("files")?.append(stashButton, popButton, saveButton);

  // The list and the editor are built once and then only refreshed. Rebuilding
  // the textarea on every keystroke is what threw the caret away mid-word.
  const fileList = document.createElement("ul");
  fileList.className = "file-list";
  const editor = document.createElement("textarea");
  editor.className = "file-editor";
  editor.dataset["control"] = "files";
  editor.dataset["testid"] = "file-editor";
  editor.addEventListener("input", () => {
    if (selectedFile === undefined) return;
    apply(edit(world, selectedFile, editor.value), `edit:${selectedFile}`);
  });
  const browser = document.createElement("div");
  browser.className = "files-browser";
  browser.append(fileList, editor);
  bodies.get("files")?.append(browser);

  const redraw = (): void => {
    renderFiles();
    renderIndex();
    renderGit();
    renderServer();
    lock();
  };

  // Two different reasons a control can be dead: the model makes it impossible,
  // and the stage did not name it. Render marks the first with data-off, this
  // folds both into disabled, so the only writer of disabled is here and the
  // two can never quietly undo each other.
  function lock(): void {
    const may = phase === "tour" ? new Set<Control>() : allowed(cursor);
    for (const el of stage_.querySelectorAll<HTMLElement>("[data-control]")) {
      const named_ = el.dataset["control"] as Control;
      const off = el.hasAttribute("data-off") || !may.has(named_);
      el.toggleAttribute("data-locked", off);
      if (
        el instanceof HTMLButtonElement ||
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement
      ) {
        el.disabled = off;
      } else {
        el.setAttribute("aria-disabled", String(off));
      }
    }
  }

  const say = (text: string): void => {
    if (said !== null) said.textContent = text;
  };

  // The walkthrough, in three parts a beginner needs together: where they are
  // in the walk, what to do next, and why it is worth doing. The third is the
  // reason the piece exists - an explainer whose every line reads "press this"
  // has explained nothing - so it carries real sentences rather than a label.
  interface Place {
    run: number;
    runs: number;
    step: number;
    steps: number;
    title: string;
  }

  // Held so a resize across the breakpoint can re-place the same instruction
  // rather than blanking it: the words are unchanged, only where they live is.
  let saidHint: { text: string; why: string; at?: string; place?: Place } = {
    text: "",
    why: "",
  };

  const suggest = (
    text: string,
    why: string,
    at?: string,
    place?: Place,
  ): void => {
    saidHint = {
      text,
      why,
      ...(at === undefined ? {} : { at }),
      ...(place === undefined ? {} : { place }),
    };
    if (hintWhere !== null) {
      hintWhere.textContent =
        place === undefined
          ? ""
          : `Run ${String(place.run)} of ${String(place.runs)} · ` +
            `${place.title} · step ${String(place.step)} of ` +
            String(place.steps);
      hintWhere.toggleAttribute("hidden", place === undefined);
    }
    if (hintDo !== null) hintDo.textContent = text;
    if (hintWhy !== null) hintWhy.textContent = why;
    if (promptLine !== null) {
      promptLine.toggleAttribute("hidden", text === "");
      // Narrow has no gutter to point from, so the instruction becomes a bar
      // across the top of the screen and the accent border does the pointing.
      if (narrow.matches) screenEl?.prepend(promptLine);
      else if (at !== undefined) panels.get(at)?.append(promptLine);
    }
    for (const [id, panel] of panels) {
      if (id === at) panel.setAttribute("data-hint", "true");
      else panel.removeAttribute("data-hint");
    }
  };

  narrow.addEventListener("change", () => {
    closeTouchNote();
    suggest(saidHint.text, saidHint.why, saidHint.at);
  });

  // A commit rising out of one compartment and into the next: the one piece
  // of the old picture's motion this rewrite keeps, aimed at real panels.
  function sendObject(from: string, to: string, kind: "inside" | "network"): void {
    const a = bodies.get(from);
    const b = bodies.get(to);
    if (a === undefined || b === undefined) return;
    const ms = durationFor(kind);
    if (ms === 0) return;
    const stageBox = stage_.getBoundingClientRect();
    const start_box = a.getBoundingClientRect();
    const end_box = b.getBoundingClientRect();
    const dot = document.createElement("div");
    dot.className = "flight";
    dot.dataset["kind"] = kind;
    dot.style.setProperty("--flight-ms", `${String(ms)}ms`);
    dot.style.left = `${String(start_box.left - stageBox.left + start_box.width / 2)}px`;
    dot.style.top = `${String(start_box.top - stageBox.top + start_box.height / 2)}px`;
    stage_.append(dot);
    requestAnimationFrame(() => {
      dot.style.left = `${String(end_box.left - stageBox.left + end_box.width / 2)}px`;
      dot.style.top = `${String(end_box.top - stageBox.top + end_box.height / 2)}px`;
      setTimeout(() => dot.remove(), ms);
    });
  }

  // A moment is the world and the place in the walk together. Storing the
  // world alone made Undo restore a state the instruction no longer matched.
  interface Moment {
    world: World;
    cursor: Cursor;
    entry: World;
    runEntry: World;
    seen: ReadonlySet<string>;
    mark?: string;
  }

  const history: Moment[] = [];
  const DEPTH = 50;

  function remember(mark?: string): void {
    const last = history.at(-1);
    if (mark !== undefined && last?.mark === mark) return;
    history.push({ world, cursor, entry, runEntry, seen: new Set(seen), mark });
    if (history.length > DEPTH) history.shift();
    undoButton.disabled = false;
  }

  function undo(): void {
    const last = history.pop();
    if (last === undefined) return;
    // A rewind must not be overtaken by a push that is already in the air.
    forgetReply();
    rewindTo(last);
    undoButton.disabled = history.length === 0;
    advance();
    redraw();
    say("Took that back.");
    nextPrompt();
  }

  // Walked before the redraw, never after: which step is current decides which
  // verbs get drawn and which are locked, so moving the cursor afterwards would
  // leave the page a whole action behind the instruction on it.
  //
  // A loop rather than a single move, because one action can satisfy several
  // steps at once - pressing Commit finishes a merge, which completes both the
  // step that asked for the merge and the step that asked for the seal - and a
  // walk that only advanced one step per action would fall behind the world.
  // Bounded by the total number of steps so a predicate that is somehow always
  // true cannot spin.
  function advance(): void {
    if (phase !== "runs") return;
    const limit = RUNS.reduce((n, r) => n + r.steps.length, 0) + 1;
    for (let i = 0; i < limit; i += 1) {
      const step = stepAt(cursor);
      if (step === undefined || !step.done(ctx())) return;
      const moved = nextCursor(cursor);
      // A new run starts from here, and its own steps measure from here.
      if (moved.run !== cursor.run) {
        runEntry = world;
        seen = new Set();
      }
      cursor = moved;
      entry = world;
    }
  }

  // Rewinding has to rewind the walk too, or Undo puts the world back and
  // leaves the instruction talking about something that no longer happened.
  // The cursor is restored from the same history entry as the world.
  function rewindTo(moment: Moment): void {
    world = moment.world;
    cursor = moment.cursor;
    entry = moment.entry;
    runEntry = moment.runEntry;
    seen = new Set(moment.seen);
  }

  function apply(next: World, mark?: string): void {
    remember(mark);
    world = next;
    advance();
    redraw();
    nextPrompt();
  }

  function act(next: World, at: string, told: string): void {
    apply(next);
    say(told);
  }

  // Every verb declares which control it is, so lock() can reach the ones built
  // per redraw as surely as the fixed ones in the panel headers.
  function verb(
    label: string,
    control: Control,
    run: () => void,
    undoLike = false,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "verb";
    button.dataset["control"] = control;
    if (undoLike) button.dataset["undo"] = "";
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

  // Your Files: a list on the left, the selected file's content editable on
  // the right. Editing writes straight through; Save is what stages it.
  function renderFiles(): void {
    // Stash is an advanced move, and both halves of it only make sense when
    // there is something to put aside or something waiting to come back.
    const stashed = world.local.refs[STASH] !== undefined;
    const dirty =
      headOid(world.local) !== undefined && !status(world).every(isClean);
    stashButton.hidden = !allows("stash") || !dirty;
    popButton.hidden = !allows("stash") || !stashed;

    const files = status(world).filter((s) => s.path in world.working);
    if (selectedFile === undefined || !(selectedFile in world.working)) {
      selectedFile = files[0]?.path;
    }
    fileList.replaceChildren();
    for (const s of files) {
      const item = document.createElement("li");
      item.textContent = s.path;
      const glyph = document.createElement("span");
      glyph.className = "file-glyph";
      const g = glyphFor(s);
      if (g !== "") glyph.dataset["glyph"] = g;
      glyph.textContent = g;
      item.append(glyph);
      item.dataset["testid"] = "file-item";
      item.dataset["control"] = "files";
      if (s.path === selectedFile) item.setAttribute("aria-current", "true");
      // A list item cannot be disabled, so it reads the lock itself.
      item.addEventListener("click", () => {
        if (item.hasAttribute("data-locked")) return;
        selectedFile = s.path;
        redraw();
      });
      fileList.append(item);
    }
    // Only written when it actually differs, so typing never resets the caret.
    const text =
      selectedFile === undefined ? "" : (world.working[selectedFile] ?? "");
    if (editor.value !== text) editor.value = text;
    editor.toggleAttribute("data-off", selectedFile === undefined);
    editor.setAttribute(
      "aria-label",
      selectedFile === undefined ? "No file selected" : `Contents of ${selectedFile}`,
    );
  }

  // .git/index: what is staged, each with its own unstage, plus the commit
  // message the fixed Commit button reads from, and merge status/abandon.
  function renderIndex(): void {
    const body = bodies.get("index");
    if (body === undefined) return;
    body.replaceChildren();
    const merging = world.merging;
    if (merging !== undefined) {
      body.append(
        line(
          merging.conflicts.length === 0
            ? `Merging ${merging.name}. Commit to seal it, with two parents.`
            : `Merging ${merging.name}. Resolve the conflict, save it, then ` +
              "commit.",
          "state",
        ),
      );
      body.append(
        verb(
          "Abandon this merge",
          "merge",
          () => {
            act(abortMerge(world), "index", `Abandoned the merge of ${merging.name}.`);
          },
          true,
        ),
      );
    }
    const entries = Object.entries(world.index).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) {
      body.append(line("Nothing staged.", "empty"));
      commitButton.toggleAttribute("data-off", true);
      return;
    }
    commitButton.toggleAttribute(
      "data-off",
      merging?.conflicts.some((path) => world.index[path] === undefined) ?? false,
    );
    const list = document.createElement("ul");
    list.className = "blob-list";
    for (const [path, oid] of entries) {
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "oid-swatch";
      swatch.style.setProperty("--hue", String(hueFor(oid)));
      const label = document.createElement("span");
      label.textContent = `${path} (${oid})`;
      item.append(swatch, label);
      item.append(
        verb(
          "Unstage",
          "save",
          () => {
            act(unstage(world, path), "files", `Unstaged ${path}.`);
          },
          true,
        ),
      );
      list.append(item);
    }
    body.append(list);
    const message = document.createElement("input");
    message.type = "text";
    message.className = "message";
    message.dataset["control"] = "commit";
    message.placeholder = "what this change does";
    message.setAttribute("aria-label", "Commit message");
    message.value = draft;
    message.addEventListener("input", () => {
      draft = message.value;
    });
    body.append(message);
  }

  // .git: the commit history, newest first, with the branches pointing at
  // them and the controls that move those pointers around.
  function renderGit(): void {
    const body = bodies.get("git");
    if (body === undefined) return;
    branchButton.hidden = !allows("branch");
    // Push stays live the moment there is a commit, refusal and all: being told
    // why it was refused is the lesson. Pull goes dead until somebody else has
    // actually pushed, because a Pull that fetches nothing teaches nothing.
    pushButton.toggleAttribute("data-off", headOid(world.local) === undefined);
    pullButton.toggleAttribute("data-off", !canFetch(world));
    body.replaceChildren();

    const head = headOid(world.local);
    const seen = new Set<string>();
    const commits = head === undefined ? [] : ancestry(world.local.objects, head);
    for (const c of commits) seen.add(c.oid);
    // Off-HEAD is not the same as unreachable: a fetched origin/* tip or
    // another branch's commit is live, just not on the branch you're on.
    const trueGhosts = new Set(unreachable(world));
    const ghosts = Object.values(world.local.objects)
      .filter((o) => o.kind === "commit" && !seen.has(o.oid))
      .reverse();

    if (commits.length === 0 && ghosts.length === 0) {
      body.append(line("No commits yet.", "empty"));
    } else {
      const pinned = new Map<string, string[]>();
      for (const [name, oid] of Object.entries(world.local.refs)) {
        pinned.set(oid, [...(pinned.get(oid) ?? []), name]);
      }
      if (head !== undefined) pinned.set(head, [...(pinned.get(head) ?? []), "HEAD"]);

      const list = document.createElement("ol");
      list.className = "commit-list";
      for (const c of [...commits].reverse()) {
        list.append(commitRow(c.oid, c.message, c.parents, pinned.get(c.oid), false));
      }
      for (const o of ghosts) {
        if (o.kind !== "commit") continue;
        list.append(
          commitRow(o.oid, o.message, o.parents, pinned.get(o.oid), trueGhosts.has(o.oid)),
        );
      }
      body.append(list);
    }

    body.append(branchControls());
  }

  function commitRow(
    oid: string,
    message: string,
    parents: readonly string[],
    refs: string[] | undefined,
    ghost: boolean,
  ): HTMLElement {
    const item = document.createElement("li");
    item.className = "commit-row";
    if (ghost) item.dataset["ghost"] = "true";
    item.dataset["testid"] = "commit";
    const swatch = document.createElement("span");
    swatch.className = "oid-swatch";
    swatch.style.setProperty("--hue", String(hueFor(oid)));
    const label = document.createElement("span");
    label.textContent = `${oid} ${message}`;
    item.append(swatch, label);
    // The chip is the branch, so the chip is also how you move onto it: one
    // drawing of a name pinned to a commit, doing the one thing that name can
    // do. HEAD, the remote-tracking names and the branch you are already on are
    // labels rather than destinations, so those stay plain text.
    const on = world.local.head;
    const current = on.kind === "branch" ? on.name : undefined;
    for (const name of refs ?? []) {
      const movable =
        name !== "HEAD" &&
        name !== STASH &&
        name !== current &&
        !name.startsWith("origin/");
      if (!movable) {
        const chip = document.createElement("span");
        chip.className = "ref-chip";
        if (name === current) chip.dataset["current"] = "true";
        chip.textContent = name === current ? `● ${name}` : name;
        item.append(chip);
        continue;
      }
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ref-chip";
      chip.dataset["control"] = "checkout";
      chip.textContent = name;
      chip.setAttribute("aria-label", `Move onto ${name}`);
      chip.addEventListener("click", () => {
        const next = checkout(world, name);
        if (next === world) {
          say(
            "Not while you have unsaved changes. Commit them, or put them " +
              "aside.",
          );
          return;
        }
        act(next, "git", `On ${name}. Your files changed to match.`);
      });
      item.append(chip);
    }
    if (ghost && unreachable(world).includes(oid)) {
      const back = resetTo(world, oid);
      if (back !== world) {
        item.append(
          verb(
            "Point this branch back here",
            "reset",
            () => {
              act(back, "git", "Back on the old line. The replayed ones are unreachable now.");
            },
            true,
          ),
        );
      }
    }
    void parents;
    return item;
  }

  // What is left of .git's verbs once a branch stopped being drawn as one. A
  // branch is a name pinned to a commit, and it is already drawn that way on the
  // row it points at - so checkout lives on that chip, and this holds only the
  // verbs that move pointers around. Merge is always here, because settling with
  // a teammate is the core loop; replay and reset wait for open, since rebase in
  // someone's first minute teaches nothing.
  function branchControls(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "branch-controls";
    const head = world.local.head;
    const current = head.kind === "branch" ? head.name : undefined;
    const names = Object.keys(world.local.refs).filter((n) => n !== STASH);

    if (naming) {
      const named = document.createElement("input");
      named.type = "text";
      named.className = "message";
      named.dataset["control"] = "branch";
      named.placeholder = "new branch name";
      named.setAttribute("aria-label", "New branch name");
      named.value = branchName;
      named.addEventListener("input", () => {
        branchName = named.value;
      });
      wrap.append(
        named,
        verb("Start a branch here", "branch", () => {
          const to = branchName.trim() || "feature";
          branchName = "";
          naming = false;
          act(branch(world, to), "git", `Started ${to} here.`);
        }),
      );
    }

    if (current !== undefined) {
      for (const other of names) {
        if (other === current) continue;
        if (canFastForward(world, other)) {
          wrap.append(
            verb(`Merge ${other} into ${current}`, "merge", () => {
              act(merge(world, other), "git", `Nothing to merge: ${current} moved forward to ${other}.`);
            }),
          );
          continue;
        }
        if (allows("rebase") && canRebase(world, other)) {
          // canRebase only checks direction, not content: a conflicting
          // replay is refused whole by rebase() itself, so check the result
          // before offering the button - otherwise a real conflict shows a
          // false "done" message over a screen that did not change.
          const replayed = rebase(world, other);
          if (replayed !== world) {
            wrap.append(
              verb(`Replay ${current} onto ${other}`, "rebase", () => {
                act(replayed, "git", "Same changes, new hashes. The old ones are still in .git.");
              }),
            );
          }
        }
        const next = startMerge(world, other);
        if (next === world) continue;
        wrap.append(
          verb(`Merge ${other} into ${current}`, "merge", () => {
            const conflicts = next.merging?.conflicts ?? [];
            act(
              next,
              "index",
              conflicts.length === 0
                ? `Merged ${other}. Commit it to seal the two parents.`
                : `${String(conflicts.length)} file both of you changed. Open Your Files.`,
            );
          }),
        );
      }
      if (allows("reset") && headOid(world.local) !== undefined) {
        const back = resetBack(world);
        if (back !== world) {
          wrap.append(
            verb(
              "Move the branch back",
              "reset",
              () => {
                act(back, "git", `Moved ${current} back. The commit is still in .git.`);
              },
              true,
            ),
          );
        }
      }
    }

    return wrap;
  }

  // The Git Server: purely a visualisation, no controls at all.
  function renderServer(): void {
    const body = bodies.get("server");
    if (body === undefined) return;
    body.replaceChildren();
    const head = headOid(world.remote);
    if (head === undefined) {
      body.append(line("Nothing pushed yet.", "empty"));
      return;
    }
    const pinned = new Map<string, string[]>();
    for (const [name, oid] of Object.entries(world.remote.refs)) {
      pinned.set(oid, [...(pinned.get(oid) ?? []), `origin/${name}`]);
    }
    const list = document.createElement("ol");
    list.className = "commit-list";
    for (const c of [...ancestry(world.remote.objects, head)].reverse()) {
      const item = document.createElement("li");
      item.className = "commit-row";
      item.dataset["testid"] = "commit";
      const swatch = document.createElement("span");
      swatch.className = "oid-swatch";
      swatch.style.setProperty("--hue", String(hueFor(c.oid)));
      const label = document.createElement("span");
      label.textContent = `${c.oid} ${c.message}`;
      item.append(swatch, label);
      for (const name of pinned.get(c.oid) ?? []) {
        const chip = document.createElement("span");
        chip.className = "ref-chip";
        chip.textContent = name;
        item.append(chip);
      }
      list.append(item);
    }
    body.append(list);
  }

  // The instruction, the explanation and the lock all read the same step, so
  // what the line names is exactly what lock() leaves live. The walk never
  // runs out: past the last step of the last run it starts again at the first.
  function nextPrompt(): void {
    if (phase === "tour") return; // the tour writes its own copy
    const step = stepAt(cursor);
    const run = runAt(cursor);
    if (step === undefined || run === undefined) return;
    const c = ctx();
    suggest(sayFor(step, c), whyFor(step, c), step.at, {
      run: cursor.run + 1,
      runs: RUNS.length,
      step: cursor.step + 1,
      steps: run.steps.length,
      title: run.title,
    });
  }

  // Names the next entity and hands it its own sentence. Once all four are
  // named the tour is over for good: the curriculum takes the hint from here,
  // and there is no way back into a phase that only introduces things.
  function reveal(): void {
    const id = TOUR_ORDER[shown];
    if (id === undefined) return;
    panels.get(id)?.setAttribute("data-revealed", "true");
    shown += 1;
    drawArrows();
    suggest(`This is ${PANEL_TITLE[id] ?? id}.`, WHAT[id] ?? "", id);
    if (shown < TOUR_ORDER.length) return;
    phase = "runs";
    nextButton.remove();
    advance();
    redraw();
    nextPrompt();
  }

  advance();
  redraw();
  reveal(); // Your Files, named before the visitor has pressed anything
}
