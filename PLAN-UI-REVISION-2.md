# Plan: the second interface revision

The first revision pass (`PLAN-UI-REVISION.md`, steps 20–28) fixed the palette,
the naming, the row order and the icon's disappearance. Looking at the result
again found four things it had not fixed and one it had made worse. This plan is
the prompt below, turned into a sequence of instructions.

## The prompt, verbatim

> the how to git title should first appear center screen on load, and the user
> has to scroll down to see the main stage which is 100vh. remove the "fold this
> away" pop up menu - clicking on the svg does the same thing (or it should).
> the pop up interaction is super annoying and poor UI. get rid of it, there
> needs to be a cleaner way to surface the interactions. titles for entities
> should sit CENTERED in the div. the SVG icons SHOULD SIT ON THE LEFT OUTSIDE
> THE DIVS, i.e. outside the borders. its cleaner that way. the main stage still
> does not fill to 100vh, please fix that this round

## The instructions

Each is one step of `BUILD_PLAN.md` (29–33) and ends with the review gate in
`CLAUDE.md`.

### 29. The icon leaves the box

- In `layout.ts`, an open frame's border starts *after* the gutter: `box.x` moves
  right by `m.gutter` and the icon is drawn at `at.x`, outside the border.
- The frame's title is centred on the head line the layout already reserves,
  rather than left-aligned next to the icon.
- An open frame's hit target becomes its icon rather than its whole interior, so
  the icon is the switch and the interior belongs to its contents. `SceneNode`
  already separates drawn box from hit target; `node()` gains an optional
  explicit hit for this one case.

### 30. A title screen, and a stage that is a whole viewport

- `index.html` gains two sections inside `main`: a `.cover` holding the `h1`,
  centred on screen, and a `.screen` holding the picture.
- Each is `height: 100dvh` — definite, so the SVG's percentage height has
  something to resolve against — with `scroll-snap-align: start` and proximity
  snapping on `html`.
- The page-wide `max-width` goes. The picture is wider than it is tall, so it is
  width-limited: capping the page letterboxes it against the viewport it was
  just given.

### 31. The pop-up goes, and the lane takes over

- Pressing an entity toggles it, open or closed. Frames no longer open an
  inspector at all, so "Fold this away" has nothing to be a verb in.
- Everything that lived in a frame's inspector moves to a lane beside the
  picture: one card per open entity, holding that entity's sentence and its
  verbs (commit and abandon-merge on the index, push/teammate/fetch on the
  server, stash on your files, start over on the device).
- Each card stands level with the row it belongs to, sliding down only far
  enough to clear the card above it, so the lane reads top to bottom in the same
  order as the picture. The suggestion is one more card in the same lane.
- `render.ts` gives up owning the hint: it keeps `highlight(id)` for the pale
  blue border and gains `topOf(id)`, and the page owns every word of HTML. On a
  phone the lane becomes a strip under the picture and drops the sentences,
  which is the scarcest surface in the piece.
- Object inspectors stay. A file's inspector is an editor anchored to the file,
  not a menu that had to be summoned to reach a verb that could have been on
  screen already.
