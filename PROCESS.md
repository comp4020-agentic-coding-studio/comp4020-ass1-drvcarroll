# Process overview

## What I built

An interactive explainer for DNS at the scale it actually runs at. The page
opens on the smallest network that is still DNS — one machine, one resolver, one
authoritative server — and you grow it, then set the query rate, the TTL, the
record mix, each server's capacity, whether it is up, and where an attacker is
standing. The argument is one you have to break to believe: the hierarchy is
held up by memory rather than by capacity, and the same memory is what carries
one lie to people who never met the liar. Shorten the TTL and the root's load
climbs; take an authority offline under a long TTL and almost nothing happens
until the entries expire.

It began as something else. The first two thirds of the history are a four-level
DNS walkthrough, and that version worked — it just was not interactive, and the
whole second half of this repo is the record of admitting that.

## The moments that mattered

### 1. Counting the verbs, and losing

The four-level version was finished and green
([`100af66`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/100af66)).
Reading it against the brief's own exemplars, the honest description of what a
visitor could do was "click Next, or pick a different level" — narration with a
button on it. The obvious move was to add controls to the existing levels. I
took the harder one and made the interaction the *subject*: one parameterised
world, growth instead of levels.

What made it a process change rather than a rewrite is that the correction went
into the harness first, before any code
([`31a8e8c`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/31a8e8c)):
a **manipulation, not narration** principle in `CLAUDE.md` that names the test I
had just failed — *count the verbs before shipping; if the honest answer is "two
buttons", the artefact is a diagram* — and states how it resolves against the
density principle already there. Every design call in the eleven commits after
it was made against that section rather than against my memory of this
conversation.

### 2. Proving the argument before drawing it

The riskiest part of the pivot was that the claim might simply not hold in a
model I had built. So the whole simulation landed headless and fully asserted
while the page was still showing the old levels
([`625366e...704f74f`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/compare/625366e...704f74f)).
`spec/sim.test.ts` is where the page's thesis is executable: same seed, same
load, `ttl: 3600` against `ttl: 1` gives a hit rate above 0.85 against below
0.25 and an order of magnitude less work at the root; an on-path attacker has
more victims than it has conversations; DNSSEC takes that to zero.

How I knew it was right: those tests were written to be *failable* and two of
them failed first. The one that mattered was determinism — my first arrival
model drew "how many queries this frame", which made every number on the page a
function of frame rate. The fix was per-machine exponential inter-arrival times
in a sorted queue, and the test that holds it compares one `stepTo(state, 300)`
against three thousand small steps. A second stream (`chance`, separate from
`load`) exists for the same reason: moving the TTL must not change *who asks
what and when*, or a comparison between two TTLs is comparing two different
worlds.

### 3. Throwing away the best code in the repo

The earlier version fetched real delegation data over DNS-over-HTTPS — 432 lines
with tests, and the most technically interesting thing here. I deleted it
([`ff66c11`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/ff66c11)).
Real zone data cannot be grown, given a TTL knob, a capacity ceiling and an
attacker without the page claiming a fidelity it does not have, and a page that
needs the network to teach anything can fail at the crit. Saying plainly that
this is a seeded model is the more honest artefact, and the best sentence in the
deleted code — on why a browser cannot watch a resolver work — survives as the
page's opening line.

### 4. Where a knob belongs

`compress, then condense` says a value belongs on the object it describes; the
new principle says the visitor needs things to do. Sixteen new parameters could
have been sixteen new controls. Instead the page's only persistent controls are
the transport and the speed slider: growth is a `＋`/`−` pair *in the picture*
beneath each tier
([`602d00e`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/602d00e)),
and everything else folds into the inspector of the thing it changes — TTL above
the record table it governs, capacity and the power switch on the server,
defences on the resolver that would check them
([`58ed5bb`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/58ed5bb)).

That commit also carries the bug that only appears once controls live inside a
panel: a knob rebuilds the panel it sits in, so the button you just pressed
stops existing and the keyboard is thrown out mid-turn. `apply()` now finds it
again by its label.

### 5. The checks that were worth wiring

Two sensors caught things looking at the page could not.

`spec/layout.test.ts` asserts the 390 px claim — nothing outside its viewBox,
nothing overlapping, tiers in order — across a *grid* of counts at both
viewports
([`9121d7f`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/9121d7f)).
Once the visitor builds the world, "it looks fine at 390" has to hold for every
world they can build, which is a test rather than a screenshot.

`spec/page.test.ts` boots `index.html` into a DOM and presses the controls
([`c6abf7f`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/c6abf7f)).
Every other suite tests one layer; this asserts the claim the pivot rests on —
that pressing the picture reaches the simulation. It immediately found
`render.ts` betting on an SVG interface that not every DOM defines.

## Where to look

The pivot is
[`31a8e8c...c6abf7f`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/compare/31a8e8c...c6abf7f),
twelve commits in build order, each one green. `STRUCTURE.md` is the design
argument and was rewritten last, once the shape was known; `CLAUDE.md`'s two
design principles are the rules the code was held to.
