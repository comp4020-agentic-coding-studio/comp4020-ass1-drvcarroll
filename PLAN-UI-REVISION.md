# Plan: the interface revision pass

Steps 1–19 of `BUILD_PLAN.md` built a correct model of git and drew it. This
plan is the correction to the interface, which is the weakest part of the
result. It is the prompt below, turned into a sequence of instructions.

## The prompt, verbatim

> UI changes are needed. First, when the SVG icon of an entity is clicked, it
> translates to the left, in which the "box" containing it's contents appears,
> and these two items share the row. should the svg be clicked again, it
> translates back to the center, and the box dissapears (after an animation in
> which it "shrinks" into itself as the vertical borders close into the middle).
> that way the user can track all entities. Second, the "your laptop" should be
> changed to "Local Device", and capitalise all labels in general when referring
> to entities (i.e. Your Files, Git Server, etc.). The your files section should
> be a row in itself, underneath the .git/index row, which is then underneath
> the .git row. finally, remove the final <p> div at the bottom, and have the
> stage fill the rest of the page. the first <p> section is also unecessary -
> the "tutotiral hints" should be on the right side, aligned with the entity row
> that it references, and should also highlight the entity in blue. for example,
> if Your Files should be interacted with by the user, it should have a pale
> blue border (like the hover/focus animation). finally, there needs to be an
> "Undo" button that removes the last interaction the user did. this means
> tracking the last change and state. finally, the colours should mirror the
> github UI style - black background, and light grey borders, and so forth.
> modify the title to say "How to GIT: An interactive explainer". finally,
> update the process file to add that while sturcturally opus is quite good, it
> is actually quite terrible at user interface when a project undergoes many
> revisions - more self reflection stages ened to be built into the claude
> harness. then, update the claude.md file to enforce a reflective phase AFTER
> EVERY STEP, to assess against the assignment specification, general UI
> principles and design practices, usability metrics, and colour theory.
> PROMPT: turn the previous text blob into a seuqence of instructions that
> claude can follow.

## The instructions

Each is one step of `BUILD_PLAN.md` (20–28) and ends with the review gate in
`CLAUDE.md`: implement, check, look at both viewports, commit, review against
the spec, review against the design principles, re-align.

### 20. A considered dark palette

- Replace the `:root` tokens in `styles.css` with GitHub's dark vocabulary:
  near-black canvas (`#0d1117`), panel (`#161b22`), light grey borders
  (`#30363d`), foreground (`#e6edf3`), muted (`#8b949e`), accent blue
  (`#58a6ff`), and the status trio (`#3fb950`, `#d29922`, `#f85149`).
- Set `color-scheme: dark` so form controls and scrollbars follow.
- Re-derive every rule that assumed a light ground: the oid swatch fill and
  stroke, the oid text, chip fill and chip text, the note halo, the verb button
  (dark text on blue, not white), the inspector shadow, and the two inset
  fields.
- Keep every value at or above 4.5:1 against its own background.

### 21. Name things properly

- `<title>` and `<h1>` become "How to GIT: An interactive explainer".
- `FRAMES` in `layout.ts`: "your laptop" → **Local Device**, "the git server" →
  **Git Server**, "your files" → **Your Files**, `.git` and `.git/index`
  unchanged (they are literal paths).
- Follow the rename through the prose that names them: the entity sentences and
  orientation prompts in `app.ts`, and the SVG's `aria-label`.

### 22. One entity per row

- Inside the device, stack three full-width rows: `.git`, then `.git/index`,
  then `Your Files`.
- Delete the side-by-side split of the client bar and its wide/narrow branch —
  one stacking rule now serves both viewports.
- The change travels upward (files → index → `.git` → server) and the reading
  order is the same, which is the argument the new order carries.

### 23. The icon never leaves

- Opening an entity translates its icon to the left of its row; the contents box
  grows beside it and the two share the row.
- Closing translates the icon back to the centre of the row while the box
  shrinks into itself, its vertical borders closing to the middle.
- In `layout.ts`, an open frame reserves a left gutter for its icon and starts
  its content area after it. In `render.ts`, an open frame draws its icon in
  that gutter rather than hiding it. The transition is CSS on the shape.
- Every entity is trackable at all times, open or closed.

### 24. The picture is the page

- Remove both `<p>` elements from the visible page. Keep them in the DOM,
  visually hidden: `[data-said]` is the `aria-live` mirror and the spec's
  `data-testid="output"` hook, and `[data-prompt]` is the accessible copy of the
  hint.
- The stage fills the remaining viewport height: body a column flex, stage
  `flex: 1`, and the SVG sized to its box rather than capped at `68vh`.

### 25. The hint points

- The suggestion renders beside the picture, on the right, vertically aligned
  with the entity row it refers to.
- That entity gets a pale blue border, the same treatment hover and focus
  already use.
- The alignment is computed by the same SVG-unit-to-pixel conversion the
  inspector's anchor already uses, and is recomputed on resize and on every
  redraw.
- Each stage in `stages.ts` names the entity its prompt refers to.

### 26. Undo

- One control that takes back the last interaction, restoring both the world and
  the set of open entities from before it.
- A history stack pushed on every verb and every open or close, capped, and
  disabled when empty. It lives on the picture, not in `main`, so no verb moves
  out of the inspector that owns it.
- Note the tension out loud: `CLAUDE.md` asks for reversal in the subject's own
  vocabulary, and the git verbs keep theirs. This is the escape hatch beneath
  them, added because a visitor who cannot back out stops poking the model.

### 27. `PROCESS.md`

- Add what this pass demonstrated: structurally Opus held up well under
  revision, and the interface did not — it is quite terrible at user interface
  when a project undergoes many revisions.
- The correction is harness-level: more self-reflection stages need to be built
  into the Claude harness rather than requested by hand each time.

### 28. `CLAUDE.md`

- Enforce a reflective phase after **every** step, assessed against: the
  assignment specification, general UI principles and design practice, usability
  metrics, and colour theory.
