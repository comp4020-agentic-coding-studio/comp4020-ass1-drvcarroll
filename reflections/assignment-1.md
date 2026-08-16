# Assignment 1

## What was the breakthrough that moved the work forward?

Auditing my own design and finding a hole in it, before writing the code that
would have had the hole in it.

I had a finished DNS explainer and replaced it with a git one, which felt like
the big decision at the time. It was not. The real one came just after, when I
walked the new design against the design principles in `CLAUDE.md` instead of
against my enthusiasm for it, and noticed two things. Twelve stages in a fixed
order, each with an instruction, is a Next button no matter how it is
triggered. And an explainer about version control had nothing you could take
back.

Both corrections went into `CLAUDE.md` as rules before any code existed:
**stages record, they never gate**, and a verb ships with its reversal or it is
not finished. The second one stopped being damage control almost immediately.
Unstage, discard and reset are the things people most want from git and least
understand, so the gap in the design turned into the best part of the piece.

## What did this work change about who I want to be as a software developer?

I want to be the kind of developer who writes the rule down rather than
remembering it.

The habit that actually changed my output was the review gate: every step ends
with check, look at the rendered page, commit, review against the spec, review
against the principles, amend the plan. The "look" is the one I would have
skipped. A step passed 293 tests and was visibly wrong the moment I opened it,
twice in a row. A green suite is not a substitute for looking, and I now know
that from my own repo rather than from a slide.
