# COMP4020 prototype

This is your starter repo for a COMP4020 prototype: a static site written in
HTML/CSS/TypeScript that builds to plain HTML/CSS/JS and deploys to GitHub
Pages. The **deployed site is what gets marked** --- not this repo, and not "it
works on my machine". It's marked live in Chrome against the deployed URL at two
viewports --- 1920×1080 (desktop) and 390×844 (phone) --- and both count in
full, so make that artefact good at both and use the checks below to know
whether it is.

The course website publishes this deliverable's brief and spec. The brief poses
the problem; the spec is the fixed contract every response must satisfy. This
repo's name tells you which deliverable applies. Run the course plugin's
**start** skill at the start of each week: it pulls the right spec from the
course API, carries your harness forward from last week, and helps you turn the
spec's checkable lines into tests of your own. Read the brief and spec before
you plan or build, and see `spec/README.md` for how the checks relate to them.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Before you push, run `pnpm check`. It runs most of what CI runs --- build,
  lint, and the spec --- so you catch those in seconds instead of waiting for
  the pipeline. The links check, the evidence check, the secrets scan, and the
  deploy itself only run in CI; run `pnpm dlx linkinator ./dist --silent`
  locally against a fresh `pnpm build` for the links check without waiting for
  CI.
- To see what the page actually looks like rather than what you assume it looks
  like, open it in a browser (the `agent-browser` CLI, documented on
  [the course site](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/backpressure/#agent-browser-the-rendered-page-as-ground-truth),
  works well for this). The rendered page is the truth; your mental model of it
  isn't.
- When a check fails, read its output before changing anything. Each check below
  names what it measures, and the failure message is the instruction: it tells
  you the file, the line, or the contract. Treat a red check as authoritative
  --- the page is wrong until the check is green, not until you decide it should
  be.
- Commit when the checks pass. Never commit a red state.

## The checks (your sensors)

CI runs these on every push once your repo is public. GitHub's checks UI shows
two jobs, `check` and `deploy` --- not one status per sensor below --- and
within `check` the steps run in sequence (`pnpm check` chains typecheck, build,
lint, and the spec with `&&`), so an early failure like a broken build stops the
later sensors from running for that push; fix it and push again to see the rest.
While the repo is private (all week, until you ship) the CI jobs stay skipped
--- `pnpm check` is the same roster on your machine, and it's the faster loop
anyway. They aren't hoops. Each is a different way of finding out something true
about the site that you can't reliably see by looking at it.

They also carry a mark at a crit: the sweep runs fifteen minutes after your
cutoff, and green checks there are worth half that week's shipped mark. Still
running counts as not green, so ship with time for CI to finish.

- **typecheck** --- `tsc --noEmit` runs first in `pnpm check`, so a type error
  stops the roster before the build even starts. The types are extra
  backpressure: a red here is the compiler telling you a claim in the code is
  false.
- **build** --- the site must build (`pnpm build`). A build failure means the
  deployed site is broken or stale, so nothing else matters until this is green.
- **deploy / online** --- the live GitHub Pages URL must load and return the
  page you expect. An asset that 404s on the deployed URL counts as broken even
  if it loads locally.
- **spec** --- `spec/invariants.test.ts` asserts what's true of any good
  website, whatever the week's brief asks; the tests you write for the week's
  spec run alongside it (any `spec/*.test.ts`). A failure names the contract
  you haven't met yet.
- **lint** --- `stylelint` for CSS, `oxlint` for TypeScript. Flags code that's
  wrong, fragile, or non-idiomatic. Read the rule it names.
- **tests** --- any other tests you write, wherever you put them (co-located
  with your source is fine, not just `spec/`), must pass. Vitest picks up both
  this and the spec suite in one `vitest run`, the last step of `pnpm check`. A
  failing test is a claim about the site that's no longer true.
- **evidence** (`pnpm check:evidence`) --- checks your process evidence:
  `PROCESS.md`'s citations resolve to real commits, the current deliverable's
  exact reflection is in `reflections/` (worked out from this repo's name
  against the public course API), and your `CLAUDE.md` is present. Evidence
  gates the deploy --- `deploy` needs `check` to pass, so failing evidence
  blocks the deploy alongside everything else. See
  [Your process is part of the mark](#your-process-is-part-of-the-mark) below,
  and the course website's
  [assessment page](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/assessment/#what-you-submit)
  for what counts as evidence.
- **links** --- internal links must resolve. A broken link is a dead end you
  didn't mean to ship.
- **secrets** --- the repo is scanned for committed credentials. Never put a
  key, token, or password in a tracked file. If one leaks, rotate it. A local
  pre-commit hook (`.githooks/pre-commit`, installed by `pnpm install`) also
  blocks any commit containing something shaped like an API key --- by the time
  CI sees a key it's already pushed, so the hook is the sensor that matters.

Nothing here measures **accessibility** or **performance** --- wiring those
sensors (`axe-core`, Lighthouse, or whatever you choose) is your work, and later
in the course the spec will ask you to show how you tested both. When you do,
read a green performance result honestly: it's a lab estimate from one run on a
CI machine, not proof the site is fast for real users.

## The stack is swappable

Out of the box this is plain HTML/CSS/TypeScript on Vite, and every `.html` file
in the repo is a page: add pages, link them, and the build picks them up with no
config. That's a default, not a rule (unless the week's spec says otherwise).
You can swap in Astro or any other static generator, because nothing in CI names
a tool --- the whole contract is:

- `pnpm build` emits the complete site into `dist/`
- the `package.json` scripts (`check`, `check:evidence`, `build`) keep working
- whatever lands in `dist/` still passes the invariants in `spec/`

Two things bite in a swap. The deployed site lives under a path
(`…github.io/<repo>/`), so configure your generator's base path --- this
template's Vite config uses relative asset URLs to sidestep that, but most
generators (Astro included) need `base` set explicitly, and getting it wrong
looks fine locally while every asset 404s on the live URL. And commit the
updated `pnpm-lock.yaml`: CI installs with `--frozen-lockfile`.

For the course default (Astro) or the bare hand-written arm, don't wire the swap
by hand: the course plugin's `stack` skill runs a tested conversion script that
handles both of the traps above plus the CI link-check patch, and leaves the
whole change staged as one reviewable diff.

## Your process is part of the mark

The deployed page is only half of it. How you got there is marked too: your
commit history, your agent files, and the decisions visible across them. The
checks above can't see any of that, so a person reads it directly --- which
means building legibly is part of building well.

- **Commit as you go.** Small, frequent commits are the record of how the work
  came together, and that record is read, not just the final state. A trail that
  grew alongside the code is the strongest evidence of your process; a single
  dump the night before is the weakest.
- **Keep a process overview** (`PROCESS.md`). A short reading-guide, not an
  essay: what you built, the moments that mattered --- each pointing at a
  commit, a `CLAUDE.md` change, or a prompt and the commit it produced --- and
  where to look in the history. It points a marker at the evidence; it doesn't
  stand in for it, and claims the history doesn't back don't count. The
  `PROCESS.md` in this repo is a template showing the shape and the citation
  format (link text the commit hash or range, target the commit or compare URL);
  `pnpm check:evidence` verifies your citations resolve to real commits before
  you ship. Markers follow those citations and don't trawl the repo for evidence
  you didn't cite.
- **Write your reflection in `reflections/`** --- a short markdown file in this
  repo, named for the deliverable it answers, so the number in the filename is
  the number in this repo's name (`crit-1.md` in `comp4020-crit1-<you>`,
  `assignment-1.md` in `comp4020-ass1-<you>`); `reflections/README.md` has the
  full rule. `pnpm check:evidence` checks the exact current name against the
  course API, not merely the presence of any well-named file. It answers the two
  standing prompts: the breakthrough that moved the work forward, and what this
  work changed about the developer you want to be. It stays out of the deployed
  site. It's due at the cutoff, and if it isn't in the repo by then the week
  doesn't count as shipped, however good the prototype is.
- **This file is process evidence.** The harness you build to direct the agent,
  this `CLAUDE.md` and any `AGENTS.md`, is itself read as part of how you
  worked. Keep it honest and current (see below).

You don't need a name, a student number, or any identity file in the repo: we
know whose repo it is. Spend the effort on the work.

## This file is yours

This CLAUDE.md is a starting point, not a fixed rulebook. As you learn what your
prototype needs --- a convention to hold the agent to, a sensor that keeps
catching you out, a fact about the stack the agent keeps getting wrong --- write
it down here. Growing this file is the work of harness engineering, and the gap
between this boilerplate and your own version is part of what your prototype
says about the developer you're becoming.

## Work against the spec and the marking criteria, every stage

The published spec is the contract and the marking bands are how it is scored.
Neither lives in this repo, so they are easy to drift from — which is exactly
why they get consulted rather than remembered. Pull them from the course API
(`/api/assessments/<slug>.json` or `/api/crits/<slug>.json`, fields `spec` and
`body`) at the start of a session and re-read them at each of these points:

- **Before planning.** Restate which spec lines the proposed work serves. Work
  that serves no spec line is scope creep, however good the idea is.
- **Before building.** Name the marking band being aimed at, and what separates
  it from the band below. "Better" is not a target; the band's own words are.
- **After building.** Walk the spec line by line against what now exists, and
  say which lines are met, which are partial, and which are untouched.
- **Before shipping.** Re-read both. The spec can be updated during the week,
  and a contract you last read on Monday is not the one you are marked against.

Two standing rules fall out of this:

- **Weight the effort by the weights.** The criteria are not equal. For
  assignment 1 they are process 45%, response to the brief 35%, deployed
  artefact 20% — so an hour on the idea or on making the record legible
  outscores an hour on polish, and the plan should say so out loud.
- **Sort every spec line into checkable or judged.** Checkable lines become
  tests in `spec/`. Judged lines ("one strong idea with a point of view") get
  named in the plan so they stay visible without pretending a test holds them.

### Work from a written plan, and review at every step

Work proceeds from `BUILD_PLAN.md`, a committed list of numbered steps. Keeping
the plan in the repo makes it process evidence and lets it survive a session
ending. **Every step ends with the same review gate, and the gate is never
skipped:**

1. **Implement** the step, and nothing beyond it.
2. **Check.** `pnpm check` green. Never commit a red state.
3. **Look.** Open the rendered page at both marking viewports and confirm what
   is actually on screen matches what the step claimed to build. The rendered
   page is the truth, and a green suite is not a substitute for looking at it.
4. **Commit.** One commit, naming what changed and why.
5. **Review against the spec.** Re-read the published spec lines and marking
   bands, and say which lines this step moved, which are still partial, and
   which are untouched.
6. **Review against the design principles.** Walk the two design principles
   above against what now exists. Did a persistent control appear that belonged
   in an inspector? Did a stage become reachable without a real change to the
   model? Did a verb ship without its reversal? Did the prose grow past two
   lines?
7. **Review the interface as an interface.** The principles above are this
   project's own rules and will not catch a page that breaks the general ones.
   Against what is now on screen at both viewports:
   - **UI principles and design practice.** Alignment, proximity, and a visual
     hierarchy that matches the order things should be read in. Consistent
     spacing from a scale rather than per-element guesses. One idea per region.
     Nothing decorative that carries no information.
   - **Interaction design.** Is every affordance signified before it is used
     rather than discovered by failing? Does every action produce visible
     feedback at the object it happened to? Is state legible without being
     narrated? Can the visitor always tell where they are and what they can do
     next?
   - **Usability metrics.** Steps to reach the first meaningful action; targets
     at or above 44px; whether anything is reachable by pointer alone; whether a
     keyboard visitor gets the same path; whether an error state explains itself
     rather than merely refusing.
   - **Colour theory.** Contrast at or above 4.5:1 for text and 3:1 for
     boundaries that carry meaning. A palette with one accent, used for one
     idea, not three. Hue reserved for identity rather than spent on decoration.
     Nothing signalled by colour alone.
8. **Review the code.** Does it work for the reasons the tests claim, or only in
   the cases the tests cover? Is anything now duplicated that should have been a
   modification rather than an addition? Is anything recomputed per frame that
   could be derived once? Is the file still readable end to end by someone who
   did not write it?
9. **Re-align.** If 5 through 8 found drift, amend the remaining steps in
   `BUILD_PLAN.md` before starting the next one. Amending the plan is the
   expected outcome of a review, not a sign the plan was wrong.

A step is not finished when the code works. It is finished when it has been
checked, looked at, committed, and reviewed against the spec, the principles,
the interface, and the code.

**The gate needs no human input.** It is a self-check performed and acted on
alone, in the same run, precisely so that drift is caught while it is one step
old and cheap. Nothing in it is a question for the user, a place to hand back,
or a reason to pause: it is the mechanism that makes running to the end safe,
not an interruption to it.

### Run the plan to the end without stopping to report

Once the plan is agreed, work it start to finish in one go. Do not stop between
steps to summarise, ask whether to continue, or announce what is next. The
review gate above is done silently, and the commit message is the report: a
legible commit trail is the process evidence, and a running commentary is not.

- **Do not hand back at a step boundary.** The only reasons to stop are the plan
  being complete, a genuine blocker that no assumption can get past, or
  something outside this machine that only the user can do. Name that one thing,
  keep working on everything it does not block, and never stop on it twice.
- **Re-aligning is a silent edit to `BUILD_PLAN.md`**, not a message. Reordering
  or cutting steps needs no permission; the plan already says the cut order.
- **Report once, at the end**: what shipped, what was cut and why, and anything
  left for the user.

The review gate and this rule are not in tension. The gate is what makes running
to completion safe: every step is reflected on before the next one starts, so a
long unattended run cannot drift far, and the reflection costs a few minutes
against a whole pass rebuilt later. Skipping the gate to move faster is the one
way to make the run worth less than not having made it.

## Design principle: compress, then condense

Aim for the most information in the least interface. A minimal UI is not one
with less in it — it is one where nothing is spent twice. Prefer, in order:

1. **Cut it.** Anything not serving the one idea is removed, not shrunk.
2. **Fold it into something already on screen.** A value belongs on the object
   it describes. Prefer direct manipulation of the thing over a separate
   control that acts on it at a distance.
3. **Reveal it on demand.** Detail hides behind the object it belongs to and
   appears when asked for — progressive disclosure, so depth costs nothing
   until it is wanted.
4. **Only then, add a control.** A new persistent element is the last resort
   and needs a justification the other three could not meet.

Modern idioms that buy density cheaply, and are expected here: direct
manipulation over form controls, hover and focus for detail rather than
permanent labels, state carried in the visual (colour, weight, motion) rather
than restated in prose, and one canvas reconfigured rather than stacked panels.

This is a density target, not a sparseness target. Empty is as much a failure
as cluttered: whitespace that carries no information is wasted, and so is a
paragraph restating what the graphic already shows.

### What the finished display owes the visitor

- **What is on screen at rest is the minimum that carries the current state.**
  An object shows its identity and one status glyph. Content, detail, history
  and full text live in the inspector opened from that object. Information the
  visitor did not ask for is dumped, not displayed.
- **Surface grows only as the visitor earns it.** Regions not yet reached stay
  closed rather than pre-populated with everything the page can eventually show,
  and a closed thing carries a small badge of what is inside so folding it away
  costs no information.
- **Two lines of prose on the canvas, ever**: one suggestion of what to do next,
  one consequence of what just happened. Explanation belongs beside the thing
  being explained, where it costs nothing until asked for: one sentence saying
  what that entity is, because naming the components before the process is what
  makes the process legible.
- **Disclosure is not the same as a pop-up.** A verb belongs to the object it
  acts on, but "belongs to" is about position, not about being locked behind a
  panel. Where a thing has two states and few verbs, its verbs stand beside it
  for as long as it is open, level with it, rather than waiting behind a menu
  that has to be summoned and then dismissed. Keep a panel only where there is
  something to work in - text to edit, a field to fill - and count every
  summon-and-dismiss the visitor has to perform to reach a button that could
  have been on screen already.
- **Feedback appears at the object it happened to.** Information placed far from
  the thing it describes is read as unrelated, and a status line below the
  picture splits attention at the moment the concept is forming. A page-level
  live region stays as the accessible mirror, not the primary channel.
- **Prefer a difference that can be seen over one that must be read.** Where the
  argument turns on same or different, two identifiers or two states, carry it
  in a preattentive channel like colour or position and let the text be the
  supporting detail rather than the signal. Never colour alone.

## Design principle: manipulation, not narration

The visitor must change the system, not their position in a story about it. A
control that only advances a fixed sequence is narration with a button on it,
and no amount of polish on that button makes the page interactive.

- **Every parameter the explanation depends on is a parameter the visitor can
  set**, and the outcome has to visibly move when they set it. A constant the
  argument leans on is a knob that has not been built yet.
- **Prefer knobs that can produce a bad outcome.** A model you cannot break
  teaches nothing about why it holds up. Failure states reachable by the
  visitor's own hand are the point, not an edge case to be defended against.
- **Name the pairs before building.** For each control, say which parameter it
  changes and which readout moves in response. A control with no readout is a
  toy; a readout with no control is a chart.
- **Count the verbs before shipping.** If the honest answer is "two buttons",
  the artefact is a diagram, whatever else is true of it.

Sequencing controls (play, step, speed, next, back) are a transport for a model,
never the interaction itself. They earn their place only once there is a model
to pace, and they are not evidence that the page is interactive.

### Progression is earned, not advanced

An explanation that builds understanding slowly is a sequence of stages, each
teaching one thing. The danger is that a staged explainer is the case most
likely to reach for a transport control, so the rules are stricter here, not
looser.

- **A stage unlocks on a real change to the model, never on a button press.**
  The unlock condition is a predicate over system state. If a stage can be
  reached without the visitor changing anything, it is narration.
- **Stages record, they never gate.** The prompt suggests the next concept; any
  action that is legal in the current state stays available at all times,
  whatever stage introduced it. A fixed enforced order is a next button wearing
  a costume, however it is triggered, and the willingness to be poked out of
  order is the whole difference between an explorable model and a tutorial.
- **Later stages reuse the verbs learned in earlier ones** rather than
  introducing new controls. The last stage should add no surface at all.
- **Scaffolding must fade.** When the stages are exhausted the instruction
  retires and everything stays available, so there is somewhere to consolidate
  what was learned.

### Every action can be taken back

A visitor who cannot back out stops poking the model, and a model nobody pokes
teaches nothing. Reversal is therefore a correctness requirement, not a
courtesy, and it is what makes "prefer knobs that can produce a bad outcome"
safe to mean.

Where the subject has its own vocabulary for undoing, **use that vocabulary
rather than a generic undo button**. The reversal is then a lesson rather than
an escape hatch, and it usually turns out to be the thing the visitor most
wanted to understand. A verb ships with its reversal or it is not finished.

This sits in tension with compress-then-condense, deliberately. That principle
removes surface; this one demands the visitor have things to do. They resolve
the same way every time: a knob belongs on the object it changes, so growing
what the visitor can do should grow the page's density rather than its area.

## Code Style Guide

The general architecture and structure of any software solution should be planned and
confirmed with the user before execution. All code written should be:
- Modular
- Efficient
- Extensible
- Readable

Each language should follow the official styleguides, or those from google if official ones
are unavailable.

Comments should be descriptive but concise, no more than 2 lines of text max. Each line
of code should be no more than 80 characters per line. The same expression can span
multiple lines - an 80 char limit is purely for readability.
