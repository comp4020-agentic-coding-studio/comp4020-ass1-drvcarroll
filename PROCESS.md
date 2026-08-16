# Process overview

## What I built

An interactive explainer for git, built around one claim: **your code is on your
machine.** It opens on two icons and a gap — a laptop, and a server behind a
dotted line — and everything else is something you open. Inside the laptop are
your files, the index and `.git`, drawn as the same cylinder as the server,
because the misconception being attacked is that history lives on GitHub. You
edit a real file, stage it, and seal it into a commit whose id is a hash of its
contents. Only two commands cross the gap.

## The moments that mattered

### 1. Counting the verbs, and losing twice

The DNS version was finished, green and interactive, and I replaced it
([`4517df2`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/4517df2)).
The subject was not the problem; the point of view was. The correction went into
the harness before any code
([`912cfde`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/912cfde)),
and named a failure I had not yet made: twelve ordered stages, each with an
instruction, is a Next button wearing a costume. So `CLAUDE.md` says **stages
record, they never gate** — anything legal in the current state is available.

### 2. An explainer about version control with no undo

The same audit found nothing in the design could be taken back, and a visitor
who cannot back out stops poking the model. The rule that landed makes reversal
a *correctness requirement*, in the subject's own vocabulary where it has one,
so the reversal is the lesson. A gap turned into the strongest idea in the
piece: unstage, discard and reset are what people most want from git and least
understand
([`835142d`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/835142d)).

### 3. Proving the model before drawing it

The object model landed headless and fully asserted, with nothing on screen
([`4935b44...6d1d35c`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/compare/4935b44...6d1d35c)).
One invariant carries most of the explainer: **a commit's id is a hash that
includes its parents.** Get that right and rebase producing different hashes for
identical content falls out of the model rather than out of a caption.

### 4. Structurally sound, and blind to its own interface

Step 6 passed 293 tests and looked wrong the moment I opened it
([`345094f`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/345094f)).
The picture was drawn into a fixed 1000-unit box whatever was in it, so two
icons rendered tiny in an empty canvas. None of that is expressible as an
assertion I would have thought to write, so the review gate made *look at the
rendered page at both viewports* unskippable. It kept paying: driving the page
later found four more defects a green suite could not see
([`92c2aa1`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/92c2aa1)).

The pattern held, and it is the honest finding of the build. Structurally the model
took nineteen steps of revision without a seam: every verb stayed
`(World, args) => World`. The interface did not. Over those revisions it drifted
into a default light theme, entities that vanished when opened, and prose
further from the picture than the thing it described — each defensible one step
at a time, none of it together. It took a person looking at the page to say so,
and the fix was another nine steps
([`db1c0cd...c4aa2bd`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/compare/db1c0cd...c4aa2bd)). Structure has tests and
types pulling it straight; an interface has nothing pulling that way unless the
harness supplies it, so the review gate now assesses UI principles, interaction
design, usability metrics and colour theory after **every** step. That belongs
in the harness by default, not asked for once the drift is visible.

## Where to look

`BUILD_PLAN.md` is the committed step list this was built from, the interface
pass and its prompt are in `PLAN-UI-REVISION.md`, and `CLAUDE.md` holds the
rules. The pivot runs
[`912cfde...835142d`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/compare/912cfde...835142d),
every step checked, looked at and reviewed before the next began.
