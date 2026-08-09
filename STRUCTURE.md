# STRUCTURE

The master design reference for this prototype. It records what we're building
and why, so the shape of the thing survives contact with a week of building.
When a design decision changes, change it here first — this document is the
argument, the code is its implementation.

## The idea

DNS is the most-trusted unauthenticated protocol most people use every day.
Every website you've ever visited began with your machine asking a stranger
"where is this?" and believing the answer. There is no signature on that answer
by default, and for twenty years the only thing standing between you and a lie
was a 16-bit number.

This is an interactive explainer that makes that visible. One network graph —
client, resolvers, nameservers, a web server — that the visitor drives. Four
levels, each adding a party the visitor is implicitly trusting, until the last
one hands them the attacker's keyboard.

**The through-line:** _how does a name become an address, and who do you have to
trust for that to be true?_ Four levels are one idea, not four, because every
level is another answer to the second half of that question.

Three misconceptions the explainer exists to push against:

- **"DNS propagates."** Nothing propagates. Caches expire, at a rate the zone
  owner chose in advance.
- **"My DNS server."** That's a recursive resolver. It holds no authority over
  anything; it just does your legwork and remembers the results.
- **"My computer looks up the address."** Your computer asks one question and
  gets one answer. Something else walked the tree on its behalf.

## Core concepts that must be legible

The lynchpins. Every level below names which of these it is responsible for
landing, and no level ships until its own are legible without narration.

1. **Hierarchy and delegation.** `www.anu.edu.au.` reads right to left: root,
   `au`, `edu.au`, `anu.edu.au`, host. No machine knows everything. Each level
   knows only who to ask next. Scale falls out of this.
2. **Recursive resolver vs authoritative nameserver.** A recursor does legwork
   and caches. An authoritative server holds zone data, does no legwork, and
   either answers or points elsewhere. Conflating these two is the single most
   common DNS misunderstanding.
3. **Referral vs answer.** Most responses in a resolution are not answers. They
   are "not me, ask them". Seeing that difference is most of the understanding.
4. **Records, and what each one does.** `A`/`AAAA` terminate the walk. `NS`
   builds the tree. `CNAME` restarts resolution. `MX` proves DNS isn't only the
   web. `SOA` carries the negative-caching TTL. Glue solves the chicken-and-egg
   where a nameserver lives inside the zone it serves.
5. **TTL and per-hop caching.** Every record carries an expiry, and referrals
   are cached too — which is why the root servers are barely touched in
   practice. TTL is the one knob trading freshness against load.
6. **The transport, and its trust model.** UDP port 53, one packet each way, no
   encryption, no authentication. A response is accepted if the addresses, the
   ports, and a 16-bit transaction ID match the question. That is the entire
   security model, and everything in level 4 follows from it.

## Core interaction model

One graph persists across all four levels. Levels reconfigure it; they never
replace it.

**Nodes** carry a role: `stub` (the visitor's machine), `recursor`, `root`,
`tld`, `authoritative`, `origin` (the web server we're trying to reach), and in
level 4, `attacker`.

**Edges** are query and response paths. A **packet** animates along them, and
its kind is visible at a glance: query, referral, answer, cached answer, forged.
Referral and answer must not look the same — concept 3 depends on it.

**The one interaction:** the visitor picks a domain (and from level 2, a record
type), triggers a lookup, and watches the resolution play out on the graph. A
result panel reports what happened in words: the chain of referrals, the final
answer, a cache hit, an `NXDOMAIN`, or an attack outcome.

That interaction is what `spec/assignment-1.test.ts` asserts. The trigger
control carries `data-testid="interaction"`; the result panel carries
`data-testid="output"`. Those hooks are a contract with the spec test — rename
them and the test is lying.

Everything else on the page is in service of that one interaction. Level
selection is part of it, not a second feature.

## The four levels

### L1 — The walk

The full hierarchy from the very first interaction: stub → recursor → root →
TLD → authoritative → origin. No simplified single-server warm-up, because a
simplified model here is one the app has to retract later, and un-teaching costs
more than it saves.

The visitor resolves a name and watches the recursor do the walking: three
referrals, then one answer, then the address goes back to the client. This level
establishes the visual language every later level reuses.

_Lands:_ concepts 1, 2, 3.

### L2 — Records

The answer isn't always an `A`. The visitor now picks a record type as well as a
name, and the resolution changes shape depending on what they ask for.

- A `CNAME` makes resolution visibly **restart** — the most instructive
  animation in the whole app.
- `NS` makes the delegation from L1 explicit as data rather than as behaviour.
- `MX` shows DNS routing mail, not just web traffic.
- A name that doesn't exist returns `NXDOMAIN` with an `SOA`, so failure has a
  shape too.
- Glue records explain why the parent zone has to ship an address for a
  nameserver that lives inside its child.

_Lands:_ concept 4, and reinforces 1 by making the tree's wiring inspectable.

### L3 — Caching, TTL, scale

A second client arrives. It asks for the name the first client just resolved,
and the packets never leave the recursor — the answer was already there.

Then the second client asks for a **different** name under the same TLD, and the
resolution starts partway down the tree: the recursor already knows who serves
`au`, so root and TLD are skipped. That partial hit is this level's payoff and
the thing most people have never pictured.

A TTL clock the visitor can advance shows entries expiring and the full walk
returning. A counter tracks queries sent against queries saved, so efficiency
becomes a number rather than an adjective.

_Lands:_ concept 5, and sets up the blast-radius argument in L4 — everything
that makes caching efficient also makes one lie go further.

### L4 — Trust

The transport model becomes visible: the 16-bit transaction ID shown as a live
number, and the fact that matching it is the whole acceptance test.

Two threat models, kept distinct, because the difference between them is the
lesson:

**On-path (MITM).** The attacker sits on a link and can see the query. No
guessing is needed — read the ID, answer before the real server does. The cost
of this attack is network position: open wifi, a compromised router, a hostile
ISP.

**Off-path (cache poisoning).** The attacker cannot see the query and must race
the real response while guessing the ID. The visitor tries this directly and
mostly loses. Worse, they get one attempt per name: lose the race and the real
answer is cached, and they have to wait out the TTL.

Then the **Kaminsky** trick unlocks. Don't attack `www.example.com` — attack
`random8f2a.example.com`, which nobody has cached and nobody ever will, so you
get unlimited attempts. And don't forge the address; forge the **authority**:
"the nameserver for `example.com` is me." Win once and you own the whole zone.

Then the visitor watches every other client on the graph get sent to the
attacker from cache — L3's efficiency story, running in reverse.

The level does not end there, because "everything is broken" is both wrong and a
weaker argument than the truth:

- **Source port randomisation** raises the entropy from 16 bits to roughly 32,
  and the race the visitor just won becomes visibly unwinnable.
- **DNSSEC** signs records, and the forged one fails validation.
- **DoH/DoT** encrypt the hop between stub and recursor — and _only_ that hop,
  which is worth correcting out loud, because it's widely assumed to cover the
  rest.

_Lands:_ concept 6, and closes the through-line: every party the earlier levels
introduced was a party you were trusting.

## Data model

The types that carry all four levels. L1's types are a strict subset of L4's —
no per-level forking, or the state machine becomes four state machines.

- `GraphNode` — id, role, position, display state.
- `GraphEdge` — endpoints, and whether it's currently carrying traffic.
- `Packet` — the edge it's on, progress along it, and a kind: `query`,
  `referral`, `answer`, `cached`, `forged`.
- `DNSRecord` — name, type, TTL, rdata.
- `CacheEntry` — a record plus the time it was cached, so expiry is derivable
  rather than stored.
- `LevelConfig` — which nodes, edges, records and behaviours are active, plus
  what the level is allowed to explain.
- `ResolutionResult` — the terminal state and the chain of steps that produced
  it. The result panel renders this; the tests assert against it.

## Architecture

The flat root layout the starter ships with won't survive four levels. Proposed
structure, to be introduced when L1 starts rather than pre-emptively:

- `src/graph/` — SVG rendering of nodes and edges, packet animation driven by
  `requestAnimationFrame`.
- `src/dns/` — the resolution walk, the cache, record semantics, and the attack
  behaviours. No rendering here; this module should be testable headless.
- `src/levels/` — one config module per level, plus the state machine that
  switches between them.
- `src/ui/` — the interaction control, level selector, and result panel.
- `main.ts` stays the entry point and does nothing but wire these together.

SVG, not Canvas, and not a graph library. Hand-rolled keeps the dependency count
at zero and the bundle tiny, and SVG nodes are real DOM elements — which is what
makes keyboard access and the `data-testid` hooks natural rather than bolted on.
The marker tabs through the page; that's not a detail to retrofit.

## Testability

Mechanically checkable, and therefore ours to assert in `spec/`:

- the interaction control and result panel exist (already asserted, currently
  red)
- a resolution reaches a correct terminal state for a known name
- a repeat query is served from cache
- a forged response is rejected once defences are enabled

Judged by a person at the crit, and not something a test can hold:

- that it works at both marking viewports
- that it reads as one idea rather than four
- whether the point of view is any good

Keep `src/dns/` free of DOM dependencies so the first list can be tested without
a browser.

## Out of scope

Deferred deliberately, so that adding any of them later is a decision rather
than a drift: anycast and geographic routing, EDNS(0), concurrent clients beyond
L3's demonstration pair, and the full DNSSEC key hierarchy — validation is shown
as pass or fail, not as a chain walk from the root.

## Open questions

- The visual language for cached versus in-flight. These need to be
  distinguishable at a glance and at phone width.
- How many demo domains and records ship. Enough to make L2 and L3 interesting,
  few enough that the graph stays readable.
- How literally the TXID race is simulated versus abstracted. Real randomness
  makes the failure honest; scripted outcomes make the lesson reliable.
