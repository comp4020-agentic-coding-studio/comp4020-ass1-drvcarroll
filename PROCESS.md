# Process overview

## What I built

An interactive explainer for git, built around one claim: **your code is on your
machine.** The page opens on two icons and a gap — a laptop, and a server behind
a dotted line — and everything else is something you open. Inside the laptop are
your files, the index, and `.git`, drawn as the same cylinder as the server,
because the whole misconception being attacked is that history lives on GitHub.
You edit a real file, watch git notice, stage it, and seal it into a commit
whose id is a hash of its contents. Only two commands ever cross the gap.

The history has two halves. The first is a DNS explainer; the second is this.

## The moments that mattered

### 1. Counting the verbs, and losing twice

The DNS version was finished, green, and interactive, and I still replaced it
([`4517df2`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/4517df2)).
The subject was not the problem; the point of view was. What made this a process
change rather than a rewrite is that the correction went into the harness before
any code
([`912cfde`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/912cfde)),
and it named two failures I had not yet made. Twelve ordered stages, each with
an instruction, is a Next button wearing a costume — so `CLAUDE.md` now says
**stages record, they never gate**: any operation legal in the current state is
available at all times, whatever stage introduced it.

### 2. An explainer about version control with no undo

The same audit found that nothing in the design could be taken back. A visitor
who cannot back out stops poking the model, which kills the premise. The rule
that landed says reversal is a *correctness requirement*, and that where the
subject has its own vocabulary for undoing, use that vocabulary — the reversal
becomes the lesson rather than an escape hatch. A gap in the design turned into
the strongest idea in the piece: unstage, discard, and reset are the things
people most want from git and least understand
([`835142d`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/835142d)).

### 3. Proving the model before drawing it

The object model landed headless and fully asserted while nothing was on screen
([`4935b44...6d1d35c`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/compare/4935b44...6d1d35c)).
One invariant carries most of the explainer: **a commit's id is a hash that
includes its parents.** Get that right and rebase producing different hashes for
identical content falls out of the model rather than out of a caption. Trees
sort their entries before hashing, so two identical snapshots are one id; there
is no clock in the model, because a timestamp would destroy that.

### 4. The green suite that could not see

Step 6 passed 293 tests and looked wrong the moment I opened it
([`345094f`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/345094f)).
The picture was drawn into a fixed 1000-unit box whatever was in it, so two
icons rendered tiny in an empty canvas. Step 7 was worse: the inspector covered
the object it described, and a commit's seven-character id overflowed its 44px
circle. None of that is expressible as an assertion I would have thought to
write. The review gate in `CLAUDE.md` now makes *look at the rendered page at
both viewports* a step that cannot be skipped, sitting between check and commit.

## Where to look

`BUILD_PLAN.md` is the committed step list the second half was built from, and
`CLAUDE.md` holds the rules the code was held to. The pivot runs
[`912cfde...835142d`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/compare/912cfde...835142d),
each step checked, looked at, and reviewed before the next one started.
