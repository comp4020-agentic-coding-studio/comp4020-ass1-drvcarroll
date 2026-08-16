# Build plan

The prototype is an interactive explainer of git. This file is the order it gets
built in. It is committed so it survives a session ending and so a marker can
read what was intended against what happened.

## The review gate

**Every step below ends with this, and it is never skipped.** `CLAUDE.md` holds
the full version; this is the checklist.

1. Implement the step, and nothing beyond it.
2. `pnpm check` green. Never commit a red state.
3. Look at the rendered page at 1920x1080 and 390x844.
4. Commit, naming what changed and why.
5. Review against the published spec: which lines moved, which are partial,
   which are untouched.
6. Review against the design principles: a persistent control that belonged in
   an inspector, a stage reachable without changing the model, a verb without
   its reversal, prose past two lines.
7. Amend the remaining steps here if 5 or 6 found drift.

## The idea

Your code is on your machine. Git is two computers and one gap between them, and
the only two commands that cross that gap are push and fetch. Everything else
people are afraid of happens on your laptop, alone, where nothing can be lost.

The canvas is a picture of machines, not of abstract stores: a laptop containing
your files, the index, and `.git`, and a server behind a dotted line above it.
Every entity starts as a closed icon the visitor clicks to go inside, so the
things are settled in the visitor's head before any git vocabulary arrives.

## Steps

- [x] **1. Clear the ground.** Delete `src/dns/`, `src/sim/{engine,metrics,
      topology,types}.ts`, `src/graph/animate.ts`, `src/ui/{readouts,records,
      spotlight}.ts`, and the dead spec suites. Move `src/sim/rng.ts` to
      `src/git/hash.ts`. Stub `src/ui/app.ts`. Rewrite `index.html` to the new
      skeleton with no transport controls. Cut `spec/assignment-1.test.ts` and
      `spec/page.test.ts` to the minimum that passes.
- [x] **2. The object model.** `src/git/objects.ts` and `spec/objects.test.ts`.
      Blobs, trees, commits, content-addressed oids. Headless. Same content is
      one blob; a commit's oid includes its parents, so rebase producing new
      hashes falls out of the model rather than out of a caption.
- [x] **3. Stores, status, stage, commit.** `src/git/repo.ts`,
      `src/git/status.ts`, `spec/repo.test.ts`. Status is derived, never stored.
      Still headless.
Steps 4 and 5 recreate `src/graph/layout.ts` and `src/graph/render.ts`, which
step 1 removed because both carried resolver vocabulary all the way through.
Recover the versions worth adapting with `git show 912cfde~1:src/graph/render.ts`
and the same for `layout.ts`: the scene diff, the inspector, the keyboard
handling, the resize re-anchor, `rowSizes` and the viewBox derivation are all
still the right code, and only the domain around them was wrong.

- [x] **4. The machine layout.** Rewrite `src/graph/layout.ts`: three bars, the
      lower two inside one laptop outline, the server across a network gap.
      Every entity open or closed. `spec/layout.test.ts` asserts, across the
      open/closed combinations at both viewports: nothing outside the viewBox,
      no overlap, `.git` contained within the laptop, targets at least 44px at
      420. Settle and record the commit graph direction here.
      *Settled: commits run oldest-left to newest-right, because a horizontal
      chain fits a horizontal bar and a merge becomes two lines converging from
      the left with no caption. Drawn box and hit target are separate fields on
      a node, so a ref chip can look like a chip and still be a 44px target.*
- [x] **4a. Icons.** `src/graph/icons.ts`: laptop, cylinder, folder, checklist,
      one stroke vocabulary, `currentColor`.
- [x] **5. Reduce the renderer.** Strip the DNS surface from
      `src/graph/render.ts`, keep the scene diff, the inspector, the keyboard
      handling and the resize re-anchor. Add `src/graph/motion.ts`.
- [x] **6. The canvas is live.** Entities expand and collapse on click and
      Enter/Space, with `aria-expanded` and closed badges. Read-only. Rewrite
      `styles.css`. This is the orientation experience on its own, before a
      single git verb exists, and it is worth looking at hard.
- [x] **7. The first three verbs.** Edit, stage, commit, in the inspectors of
      the objects they act on, keyboard first. Feedback annotations at the
      object; `[data-said]` is the accessible mirror.
- [x] **7a. Undo.** `src/git/undo.ts`, `spec/undo.test.ts`. Unstage and discard.
      Every later verb ships with its reversal in the same step.
- [x] **8. Drag.** Pointer only, with a grip signifier and a ghost target slot
      on press. Disabled entirely on touch. Routes to the same call.
- [x] **9. Stages.** `src/ui/stages.ts`, `spec/stages.test.ts`. Prompts suggest
      and never gate: the test asserts a later verb works before its stage is
      reached, and that reaching it out of order marks it met.
- [x] **10. Branches, merge, remote, push.** Each with its reversal. Free play
      when every stage is met: the prompt retires, start over is available.
      **This is the shippable floor.**
- [x] **11. Evidence.** Rewrite `PROCESS.md` to 400-600 words and three or four
      moments. Write `reflections/assignment-1.md`. `pnpm check:evidence` green.
- [~] **12. Ship.** All commits pushed. **Blocked on the repo being made
      public**, which needs a GitHub login this machine does not have: while it
      is private CI stays skipped and Pages 404s. Everything else continues
      around it.
- [x] **13. The collaborator, and a refused push.**
- [x] **14. Merge with two parents.**
- [x] **15. Conflicts.** Resolved with the first two verbs the visitor learned.
- [x] **16. Stash.**
- [x] **17. Rebase.** Old commits ghosted, new oids, same content.
- [x] **18. Rewrite `STRUCTURE.md`,** naming the simplifications honestly.
- [x] **19. Final checks and push.** `pnpm check` green (363 tests, 15 files),
      `pnpm check:evidence` green, links clean against a fresh build. CI and
      Pages still wait on step 12.

**Re-aligned after step 10.** Two changes, both from reviews rather than from
the plan being wrong:

- **Step 8 (drag) moves to last, and is cut first.** It is a pointer-only
  enhancement over a path that is already complete by click and keyboard, so it
  adds the least of anything left to a marked artefact. The cut order is now 8,
  then 17, then 16, then 15 degrades.
- **The fast-forward merge is a verb but not a stage.** A stage's predicate can
  only read world state, and the state left by a fast-forward — two branch names
  on one commit — is identical to the state left by simply starting a branch.
  Rather than fake it with a counter, the curriculum records branch, checkout and
  push, and merge stays available from the chip that owns it.

**Step 13 onward proceeds without waiting on step 12**, since the block is not
something building can clear.

## Revision pass: the interface, after the model was right

Steps 1–19 built a correct model and drew it. Looking at the result, the
interface is the weakest part of the piece. The prompt that asked for this pass,
and the full instructions derived from it, are in
[`PLAN-UI-REVISION.md`](./PLAN-UI-REVISION.md); the steps below are the
checklist. Entities vanish when they open, the
palette is a default light theme rather than a considered one, the two prose
lines sit far from the picture, and the hint says what to do without pointing at
what to do it to. These steps are the correction, and each ends with the same
review gate.

- [ ] **20. A considered dark palette.** GitHub's own vocabulary: near-black
      canvas, light grey borders, one accent blue. Token swap in `:root`, then
      every rule that assumed a light ground — oid swatches, chips, the note
      halo, the inspector — re-derived from the new tokens.
- [ ] **21. Name things properly.** Title and `h1` become "How to GIT: An
      interactive explainer". "your laptop" becomes "Local Device"; every entity
      label is capitalised ("Git Server", "Your Files", ".git/index").
- [ ] **22. One entity per row.** Inside the device: `.git`, then `.git/index`,
      then `Your Files`, each a full-width row of its own. The change travels
      upward — files, index, .git, server — and the reading order is the same.
- [ ] **23. The icon never leaves.** Opening an entity translates its icon to
      the left of the row and grows the contents box beside it, sharing the row.
      Closing translates the icon back to the centre while the box shrinks into
      itself, its vertical borders closing to the middle. Every entity stays
      trackable, open or closed.
- [ ] **24. The picture is the page.** Both prose lines leave the visible page;
      they stay in the DOM, visually hidden, as the accessible mirror and the
      spec's `data-testid` hooks. The stage fills the rest of the viewport.
- [ ] **25. The hint points.** The suggestion renders beside the picture,
      vertically aligned with the entity row it refers to, and gives that entity
      a pale blue border — the same treatment hover and focus already use.
- [ ] **26. Undo.** One control that takes back the last interaction, by
      restoring the world and the open set from before it. Noted as a deliberate
      exception to "reversal in the subject's own vocabulary": the git verbs keep
      their own reversals, and this is the escape hatch beneath them.
- [ ] **27. `PROCESS.md`.** Add what this pass demonstrated: structurally the
      model held up under revision, and the interface did not. Opus is good at
      structure and poor at interface across many revisions, so self-reflection
      stages need to be built into the harness rather than requested.
- [x] **28. `CLAUDE.md`.** A reflective phase after every step, assessed against
      the assignment specification, general UI principles and design practice,
      usability metrics, and colour theory.
