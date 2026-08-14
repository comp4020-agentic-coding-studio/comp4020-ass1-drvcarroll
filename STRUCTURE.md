# STRUCTURE

The master design reference for this prototype. It records what we're building
and why, so the shape of the thing survives contact with a week of building.
When a design decision changes, change it here first — this document is the
argument, the code is its implementation.

## The idea

DNS answers trillions of queries a day on a hierarchy whose top is a few dozen
machines. It does not survive that by being big. It survives because almost
every answer is a remembered one, and the same memory that holds the system up
is what makes a single lie spread.

This is one live, parameterised simulation of that. The page opens on the
smallest network that is still DNS — one machine, one resolver, one
authoritative server — and the visitor **grows it**, then sets the rate, the
TTL, the query mix, server capacity and where an attacker is standing, and
watches whether the configuration holds up.

**The through-line:** _the hierarchy is held up by memory, not by capacity —
and memory is also how one lie reaches people who never met the liar._

Three misconceptions the explainer exists to push against:

- **"DNS propagates."** Nothing propagates. Caches expire, at a rate the zone
  owner chose in advance. Set the TTL to one second and watch the root's load
  climb; set it to a day and watch an outage go unnoticed.
- **"My DNS server."** That's a recursive resolver. It holds no authority over
  anything; it just does your legwork and remembers the results. Open one: it
  is a table of borrowed answers with a clock on each.
- **"Scaling DNS means more servers."** Growing the authority tier barely moves
  the root's rate. Shortening the TTL moves it enormously.

## Core concepts that must be legible

The lynchpins. Each names how the page lands it, and none of them may depend on
prose to be understood.

1. **Hierarchy and delegation.** `www.site.au.` reads right to left, and no
   machine knows everything. The picture is tiers, so the shape of the claim is
   the shape of the graph.
2. **Recursive resolver vs authoritative nameserver.** A resolver does legwork
   and remembers; an authority holds zone data and either answers or points
   elsewhere. Open either one and it shows a different kind of thing: a cache
   with a countdown, or a zone with records.
3. **Referral vs answer.** Most messages in a resolution are "not me, ask
   them". Visible in the spotlight, where one query is walked hop by hop.
4. **Records, and what each one does.** The query mix is a knob, so asking for
   an `MX` or an `NS` that nothing holds is something the visitor does rather
   than reads about — `NODATA` is a configuration away.
5. **TTL and per-hop caching.** One knob, and it moves the load on the whole
   hierarchy. This is the page's argument, and it is a slider.
6. **The transport, and its trust model.** A response is accepted if the
   addresses, ports and a 16-bit transaction ID match the question. That is the
   entire security model, which is why arming an attacker and watching `served
   a lie` climb needs no new mechanism — only a switch.

## Core interaction model

One graph, five tiers, and the visitor builds it.

**Tiers, bottom to top:** machines that ask, resolvers, authoritative servers,
the TLD, the root. Growth controls sit in the picture — a `＋`/`−` pair beneath
each growable tier — because growing the network should mean adding to the
network, not operating a panel beside it.

**Load is shading, not packets.** Every edge carries `--load` and a band
(`ok`/`hot`/`over`) refreshed at 10 Hz, with at most twelve sampled dots in
flight on top so there is motion. One DOM packet per query would be hundreds of
element creations a second to say something the shading already says.

**Machines are openable, and that is where every knob lives.** The page's only
persistent controls are the transport and the speed slider. TTL sits above the
record table it governs; capacity and the power switch are on the server;
rate, query mix and the attacker are on a machine that asks; the defences are
on the resolver that would check them. A knob on the object it changes grows
the page's density rather than its area.

**The spotlight is the scaffold.** The aggregate view says how much work the
hierarchy is doing; it cannot say what one message is. Clicking a machine walks
one of its queries with the full transcript while the swarm keeps running,
dimmed. It resolves against a *copy* of the cache with its own draws, so
watching a query neither writes to the resolver's memory nor moves the world's
arrival sequence.

**Pacing is one control.** A single slider from `0` — paused — through
auto-play rates. Paused, `Next message` advances the world a quarter-second at
a time; following a query, it advances that query one message at a time. Same
verb, and that is what `data-testid="interaction"` is attached to.

That contract is what `spec/assignment-1.test.ts` asserts, including the
absence of the controls the pivot cut: no level selector, no threat panel.
Rename the hooks and the test is lying.

## Determinism is the load-bearing constraint

Everything else is negotiable; this is not. A run is fully described by
`SimConfig` plus a seed, which is what makes a claim on the page reproducible
in a test.

- No `Math.random()` or `Date.now()` anywhere under `src/sim/`.
- Arrivals are never drawn per frame. Each machine carries its own next-arrival
  time from `expDelay`, and `stepTo` pops the earliest until it passes the
  target. One `stepTo(state, 300)` is identical to three thousand small steps,
  so a browser frame rate cannot change a result.
- **Two streams.** `load` draws arrivals and questions; `chance` draws
  transaction IDs and the attacker's guesses. Separating them means moving the
  TTL cannot perturb who asks what and when.
- Painting is decoupled from stepping, and a frame longer than 250 ms is
  treated as a backgrounded tab rather than as work owed.

## Data model

- `SimConfig` — every parameter the visitor can set, flat, plus the seed.
- `Topology` — counts turned into nodes, edges, `Zone[]`, and the
  user→resolver assignment. Round-robin, so growth stays balanced.
- `Scene` — the topology turned into coordinates, shapes and widths for one
  viewport, plus the growth controls. The picture's own business: it copies the
  labels rather than writing into the topology.
- `SimState` — the clock, the pending arrivals, one `Cache` per resolver,
  per-node and per-edge stats, a latency ring buffer, and the totals.
- `DNSRecord`, `CacheEntry`, `ResolutionResult` — unchanged from the protocol
  layer, which is why the resolver's tests survived the pivot untouched.

## Architecture

- `src/dns/` — the resolution walk, the cache, record semantics, the attack.
  Pure and DOM-free, with every random draw injected. This is the layer that
  made the pivot cheap: `resolve()` already took its zones, cache and clock as
  parameters, so running it for many clients over simulated time was the shape
  it was already in.
- `src/sim/` — `rng`, `types`, `topology`, `metrics`, `engine`. The world.
  Also DOM-free: the page's argument is an argument about numbers, and it has
  to be checkable without a browser.
- `src/graph/` — `layout` (counts → coordinates) and `render` (a scene of
  shapes, diffed against what is on screen), plus `animate` for the spotlight's
  transport.
- `src/ui/` — `app` (the rAF loop and the wiring), `controls` (knob widgets),
  `records` (tables), `readouts` (formatted numbers), `spotlight`.
- `main.ts` wires them together and does nothing else.

SVG, not Canvas, and not a graph library. Zero dependencies, a tiny bundle, and
nodes that are real DOM elements — which is what makes keyboard access and the
`data-testid` hooks natural rather than bolted on.

## Where the data comes from

**A seeded model, and the page says so in its opening line.** Live
DNS-over-HTTPS data was built and then deliberately retired: a browser cannot
see inside a resolver's cache or make time pass, and real zone data cannot be
grown, given a TTL knob, a capacity ceiling and an attacker without the page
claiming a fidelity it does not have. Stating plainly that this is a simulation
with a seed is the more honest artefact, and the sentence that said why a
browser cannot watch a resolver survives as the page's lede.

The names come from a pool delegated straight from `au.`, and every address is
in a reserved documentation range (RFC 5737, RFC 3849); the attacker's own
nameserver is under `.invalid`, which can never be registered. Nothing on
screen names a host a visitor could go and knock on.

## Testability

Asserted in `spec/`:

- **the caching claim, executable** — same seed and load, `ttl: 3600` against
  `ttl: 1`: hit rate above 0.85 against below 0.25, and an order of magnitude
  less work at the root and TLD.
- **caching survives an outage** — every authority down under a long TTL, and
  failures stay negligible until the entries expire.
- **capacity** — a starved root drops queries and p95 jumps.
- **the lie spreads** — an on-path attacker has more victims than it has
  conversations, bounded by that resolver's users; with DNSSEC on, none.
- **determinism** — one big step equals three thousand small ones.
- **watching is free** — a spotlight query leaves the totals and the cache
  identical, and does not move the arrival sequence.
- **both viewports, for every world the visitor can build** — nothing outside
  its viewBox, nothing overlapping, tiers in order, across a grid of counts at
  wide and narrow. The 390 px claim is a test rather than a screenshot.

Judged by a person at the crit, and not something a test can hold: whether it
reads as one idea, whether the point of view is any good, and whether forty
edges converging on one resolver at phone width read as a picture or a
scribble.

## Out of scope

Deferred deliberately, so adding any of them later is a decision rather than a
drift: anycast and geographic routing, EDNS(0), the full DNSSEC chain walk
(validation is pass or fail), negative-cache tuning separate from the TTL knob,
and per-machine rates — the mix and the rate are the world's, not one dot's.

The limits in `LIMITS` are the honest limits of the picture and the browser,
not of DNS, and `withinBudget` lowers the rate rather than the crowd when the
event budget is hit. The page says the browser is the constraint rather than
clamping in silence.

## Open questions

- Whether the speed slider reads as ambiguous once it paces both the world and
  a transcript. Fallback: the spotlight always runs manual.
- How much of the argument survives without the four levels' scaffold. The
  spotlight is the mitigation, and it only works while the page opens at one
  node per tier.
- Whether `hot` and `over` at 4 and 12 q/s are the right thresholds for the
  worlds people actually build.
