# STRUCTURE

The master design reference for this prototype. It records what we're building
and why, so the shape of the thing survives contact with a week of building.
When a design decision changes, change it here first — this document is the
argument, the code is its implementation.

## The idea

Git is two computers and one gap between them, and almost everything people are
afraid of happens on the near side of that gap, alone, where nothing can be
lost.

This is one live model of that. The page opens on two icons — a laptop, and a
database behind a dotted line — and the visitor unfolds the laptop to find their
files, an index, and a second database that looks exactly like the one on the
server. Then they edit, stage, commit, branch, push, collide with a teammate,
merge, resolve a conflict, stash, and replay their work onto someone else's.

**The through-line:** _your code is on your machine. Push and fetch are the only
two commands that ever cross the gap._

Three misconceptions the explainer exists to push against:

- **"My code lives on GitHub."** `.git` is drawn inside the laptop, holding the
  same kind of thing the server holds. Everything but push and fetch happens
  below the dotted line.
- **"A branch is a copy of the project."** A branch is a chip pinned to a
  commit. Starting one creates no object; moving one is how a commit is undone.
- **"Rebase loses your work."** Replaying leaves the old commits exactly where
  they were, drawn faint with nothing pointing at them — and pointing a branch
  back at one is the undo.

## Core concepts that must be legible

The lynchpins. Each names how the page lands it, and none may depend on prose.

1. **Four places, one machine.** Your files, the index, `.git`, and the server.
   Three of them share the laptop outline; only the fourth is across the gap.
2. **Content addressing.** An oid is derived from content, so identical content
   is one blob, and every oid carries a hue derived from the same number.
   *This blob was reused, not copied* is a colour match, not a string compare.
3. **A commit includes its parents.** Which is why replaying the same changes
   produces different hashes with nothing having to say so.
4. **A ref is a name for a commit.** Branches, HEAD, `origin/main` and the stash
   are all the same shape, because they are all the same thing.
5. **Merge is three snapshots.** Base, ours, theirs. A conflict is a state, not
   an error, and it is resolved with the first two verbs the visitor learned.
6. **Nothing is deleted.** Reset, stash and rebase all leave their objects in
   the store. That is what makes every verb reversible.

## Core interaction model

One SVG, three bars, and one gap.

**Entities are icons first, interiors second.** Nothing starts as a labelled
box: the server, the laptop, `.git`, your files and the index each begin as a
drawn icon with a badge of what is inside, and open into a compartment. Opening
changes no git state, so it never counts as progress — it gates access, so
orientation happens on the way to the first verb.

**Every verb lives in the inspector of the object it acts on.** There is no
toolbar and no persistent control anywhere on the page. The last concept added
adds no on-screen surface at all, only a button inside an inspector the visitor
already knows how to open. Each inspector opens with one sentence saying what
that thing is.

**Feedback lands at the object.** A short note appears beside the thing that
changed and fades after ~2 s. `[data-said]` below the canvas carries the same
sentence as `aria-live="polite"` — the accessible mirror, not the primary
channel.

**Stages record, they never gate.** `src/ui/stages.ts` is a list of concepts
with a predicate over world state. The prompt line suggests the next unmet one;
every legal operation is available at all times regardless. When all are met the
prompt retires and the machine the visitor built stays on screen.

**Every verb ships with its reversal, in git's own vocabulary**: unstage,
discard, move the branch back, abort the merge, get the work back, point the
branch back here. There is no generic undo button, because the reversal is the
lesson.

## Data model

Everything under `src/git/` is `(World, args) => World`, DOM-free and pure.

- `objects.ts` — `Blob | Tree | Commit`, keyed by a 7-hex oid derived from
  content through `hash.ts`.
- `repo.ts` — `World` is four stores: `working` (path→text), `index`
  (path→oid), `local` and `remote` (each `{objects, refs, head}`), plus an
  optional `merging`.
- `status.ts` — the three columns compared, so the whole UI is a pure function
  of `World` and nothing derived is ever stored.
- `branch.ts`, `remote.ts`, `merge.ts`, `stash.ts`, `rebase.ts` — the verbs.

## Architecture

- `src/git/` — the model above. Proven headless before a pixel was drawn.
- `src/graph/` — `layout` (a world plus a set of open entities → boxes and
  links, at either viewport), `render` (a scene diffed against the DOM, plus
  the inspector subsystem), `icons`, `motion`.
- `src/ui/` — `app` (the wiring: one `apply()` takes a world in and redraws)
  and `stages` (the curriculum).
- `main.ts` wires them together and does nothing else.

SVG, not Canvas, and no graph library. Zero dependencies, and nodes that are
real DOM elements — which is what makes `role="button"`, Enter/Space and the
`data-testid` hooks natural rather than bolted on.

## The simplifications, named honestly

This is a model of git, not an implementation of it. Each of these is a
deliberate cut, and each is the sort of thing a marker should be told rather
than discover:

- **Trees are flat.** There are no directories, so a tree is one level of
  path→oid. Nested trees would add a data structure and teach nothing this
  piece is arguing.
- **Oids are 7 hex characters from a small mixer**, not SHA-1 or SHA-256. The
  property that matters is that the name is derived from the content and the
  parents; the cryptography is not part of the argument.
- **A commit has no author and no timestamp.** They would appear in the hash and
  make identical content hash differently for reasons the picture cannot show.
- **Merge is per-file, not per-line.** Both sides changing one file conflicts,
  even if they changed different lines of it. Real git would often merge that
  cleanly. The conflict markers written into the working file are the real
  shape, and resolution is a real edit-stage-commit.
- **A rebase that would conflict is refused whole.** Git stops halfway and asks
  you to continue; a half-rebased branch is a state this drawing has no honest
  way to show, and merge already teaches conflicts.
- **One stash, not a stack.** A second one teaches nothing the first has not.
- **The server is a single branch with no history rewriting**, and `fetch` is
  the whole network: no credentials, no protocol, no partial transfer.
- **`origin/main` is a local ref that fetch moves.** That is what git does, and
  it is why the chip sits inside `.git` rather than on the server.

## Testability

Asserted in `spec/`, 363 tests across 15 files:

- **the object model** — identical content is one blob; a commit's oid moves
  when its parents do.
- **the verbs** — stage, commit, branch, checkout, push, fetch, merge, stash,
  rebase, each against the state it is supposed to produce.
- **every reversal restores the exact prior world**, and discard is asserted as
  the one genuinely lossy verb.
- **stages record rather than gate** — a later-stage operation succeeds before
  its stage is reached, and reaching it out of order marks it met.
- **both viewports, every open/closed combination** — nothing outside the
  viewBox, nothing overlapping, `.git` enclosed by the laptop, and every
  interactive target ≥44 px at 420. The phone claim is a test, not a screenshot.
- **the page, by keyboard and click only** — no synthesised drag anywhere in the
  suite, so a green run is evidence the keyboard path is complete.

Four defects that a green suite could not see were found by driving the rendered
page instead: a second lane that was never drawn, parent links painted beneath
their own compartment, a commit born mid-interaction with no hue, and an
inspector that did not refresh as you typed. Each has a regression test now.

Judged by a person, and not something a test can hold: whether it reads as one
idea, whether the point of view is any good, and whether the graph is still a
picture rather than a scribble once a merge and a ghosted rebase are in it.

## Out of scope

Deferred deliberately, so adding any later is a decision rather than a drift:
directories, tags, remotes other than one, cherry-pick, interactive rebase,
reflog as a visible object, submodules, and drag-and-drop staging — the last is
a pointer-only enhancement over a path that is already complete by click and
keyboard, which is why it was the first thing cut.

## Open questions

- Whether the ghost lane reads as "still here" or as "greyed out and broken"
  without a caption. The commit inspector's undo verb is the mitigation.
- Whether the stash needs to be visibly distinct from a branch chip, given it
  is deliberately drawn as one to make the point that it is one.
- Whether twelve concepts is past the point where the prompt line helps, once
  every verb is already reachable from the object it acts on.
