import { ATTACKER, forge, space, type Forgery } from "../dns/attack.js";
import type { Cache } from "../dns/cache.js";
import { isWithin } from "../dns/names.js";
import { resolve } from "../dns/resolve.js";
import type { NodeId, Question, ResolutionStep, Zone } from "../dns/types.js";
import {
  createSamples,
  decay,
  quantile,
  sample,
  WINDOW,
  type Samples,
} from "./metrics.js";
import { expDelay, intBelow, mulberry32, pick, type Rng } from "./rng.js";
import { ROOT, TLD, authId, buildTopology, type Topology } from "./topology.js";
import { LIMITS, type SimConfig } from "./types.js";

// The clock and the query loop. DOM-free on purpose: the argument the page
// makes is an argument about numbers, and it has to be checkable without one.

// The attacker's own machinery. `.invalid` can never be registered (RFC 2606)
// and the address is documentation-only, so nothing here names a real host.
const ATTACKER_NS = "ns.attacker.invalid.";
const ATTACKER_ADDRESS = "192.0.2.66";

// Round-trip times in milliseconds. Constants rather than knobs: another
// slider here would buy no argument the TTL one does not already make.
const RTT = { local: 2, authority: 30, apex: 45 } as const;

// What a server does when it is past its ceiling: queue, then start dropping.
const QUEUE_MS = 250;
const DROP_FACTOR = 2;
const TIMEOUT_MS = 2000;

// The browser is the limit here, not DNS. Said out loud rather than clamped
// quietly — see LIMITS for the same honesty about the picture's size.
export const MAX_EVENTS = 600;

export interface NodeStat {
  // Everything since the run began.
  queries: number;
  drops: number;
  // Counted inside the current window, then folded into `rate` and cleared.
  window: number;
  // Queries per second, smoothed. This is what capacity is judged against,
  // and it is always the previous window's figure.
  rate: number;
}

export interface EdgeStat {
  messages: number;
  window: number;
  rate: number;
}

export interface Totals {
  queries: number;
  answered: number;
  // Answered without a single message leaving the resolver.
  cached: number;
  failed: number;
  dropped: number;
  // Forged replies the resolvers actually believed. Kept apart from `lied`
  // because the gap between the two is the entire argument: one accepted
  // forgery is served to everyone behind that cache until the TTL runs out.
  forged: number;
  // Queries that were served the attacker's answer. The thesis, as a number.
  lied: number;
}

// One arrival waiting to happen. `at` is simulated seconds.
export interface Arrival {
  at: number;
  user: NodeId;
}

// A message picked out for the eye. Most queries are never drawn — the edge
// load carries the aggregate, and this is only so there is something moving.
export interface SampledPacket {
  from: NodeId;
  to: NodeId;
  kind: ResolutionStep["kind"];
}

export const PACKET_LIMIT = 12;

export interface SimState {
  config: SimConfig;
  topology: Topology;
  // Two streams, deliberately. `load` decides when queries happen and what
  // they ask for; `chance` decides transaction IDs and the attacker's guesses.
  // Sharing one would mean a short TTL drew more IDs and thereby moved the
  // arrival times — so "same load, different TTL" would not be comparing the
  // same load, and the caching claim would be untestable.
  load: Rng;
  chance: Rng;
  // Simulated seconds. The same unit resolve() and the cache already use.
  now: number;
  caches: Map<NodeId, Cache>;
  nodes: Map<NodeId, NodeStat>;
  edges: Map<string, EdgeStat>;
  totals: Totals;
  latency: Samples;
  // Sorted ascending by `at`. Sixty users at most, so an array beats a heap
  // by the only measure that matters here: how much code it is.
  pending: Arrival[];
  nextWindow: number;
  packets: SampledPacket[];
}

const emptyTotals = (): Totals => ({
  queries: 0,
  answered: 0,
  cached: 0,
  failed: 0,
  dropped: 0,
  forged: 0,
  lied: 0,
});

const emptyNode = (): NodeStat => ({ queries: 0, drops: 0, window: 0, rate: 0 });

// Undirected on the wire and undirected here: a query and its reply are one
// exchange over one edge.
export const edgeKey = (a: NodeId, b: NodeId): string =>
  a < b ? `${a}:${b}` : `${b}:${a}`;

const rttFor = (id: NodeId): number => {
  if (id === ROOT || id === TLD) return RTT.apex;
  if (id.startsWith("auth") || id === ATTACKER) return RTT.authority;
  return RTT.local;
};

// Total queries per second the world is being asked to produce.
export const eventRate = (config: SimConfig): number =>
  config.users * config.ratePerUser;

// The zones as they can actually be reached right now: servers the visitor
// switched off are simply not there, which is what a timeout is made of.
export function visibleZones(state: SimState): Zone[] {
  const offline = new Set(state.config.offline);
  const live = state.topology.zones.filter((z) => !offline.has(z.server));
  const stolen = attackTarget(state);
  return stolen === undefined ? live : [...live, attackerZone(stolen, state)];
}

// Which zone the attacker is trying to take. The first site, so the target is
// stable as the visitor grows the tier under it.
function attackTarget(state: SimState): string | undefined {
  if (state.config.attacker === "off") return undefined;
  return state.topology.zoneOf.get(authId(0));
}

// The attacker's version of the zone. Same names, its address on all of them
// — which is the whole point: nothing about the reply looks wrong.
function attackerZone(origin: string, state: SimState): Zone {
  const ttl = state.config.ttl;
  return {
    origin,
    server: ATTACKER,
    ns: ATTACKER_NS,
    records: [
      { name: origin, type: "A", ttl, data: ATTACKER_ADDRESS },
      { name: `www.${origin}`, type: "CNAME", ttl, data: `web.${origin}` },
      { name: `web.${origin}`, type: "A", ttl, data: ATTACKER_ADDRESS },
      { name: origin, type: "SOA", ttl, data: ATTACKER_NS },
    ],
  };
}

// The attacker fires at the referral, not the answer: stealing the delegation
// wins every name in the zone until the TTL runs out.
function interceptFor(
  state: SimState,
): ((q: Question, zone: Zone, txid: number) => Forgery | undefined) | undefined {
  const target = attackTarget(state);
  if (target === undefined) return undefined;
  const { attacker, defences } = state.config;
  return (q, zone, txid) => {
    if (zone.server !== TLD) return undefined;
    if (q.name !== target && !isWithin(q.name, target)) return undefined;
    return forge(
      {
        threat: attacker,
        defences,
        zone: target,
        ns: ATTACKER_NS,
        address: ATTACKER_ADDRESS,
        guess: () => intBelow(state.chance, space(defences)),
      },
      q,
      txid,
    );
  };
}

function statFor(state: SimState, id: NodeId): NodeStat {
  const existing = state.nodes.get(id);
  if (existing !== undefined) return existing;
  const fresh = emptyNode();
  state.nodes.set(id, fresh);
  return fresh;
}

function bumpEdge(state: SimState, a: NodeId, b: NodeId): void {
  const key = edgeKey(a, b);
  const stat = state.edges.get(key) ?? { messages: 0, window: 0, rate: 0 };
  stat.messages += 1;
  stat.window += 1;
  state.edges.set(key, stat);
}

// Rates are recomputed on window boundaries in simulated time, never per
// frame, so a busy browser cannot move a readout.
function closeWindow(state: SimState): void {
  for (const stat of state.nodes.values()) {
    stat.rate = decay(stat.rate, stat.window / WINDOW);
    stat.window = 0;
  }
  for (const stat of state.edges.values()) {
    stat.rate = decay(stat.rate, stat.window / WINDOW);
    stat.window = 0;
  }
  state.nextWindow += WINDOW;
}

// One query, start to finish, with the bookkeeping the readouts are made of.
export function runQuery(state: SimState, user: NodeId): void {
  const resolver = state.topology.resolverOf.get(user);
  if (resolver === undefined) return;
  const cache = state.caches.get(resolver);
  const name = pick(state.load, state.topology.names);
  const type = pick(state.load, state.config.mix);
  if (cache === undefined || name === undefined || type === undefined) return;

  // Only worth a copy when a ceiling exists to be hit. A dropped query
  // teaches its resolver nothing, and rolling back is how that stays true.
  const capped = Object.keys(state.config.capacity).length > 0;
  const before = capped ? new Map(cache) : undefined;

  const { defences } = state.config;
  const result = resolve({ name, type }, visibleZones(state), {
    cache,
    now: state.now,
    client: user,
    recursor: resolver,
    txid: () => intBelow(state.chance, space(defences)),
    intercept: interceptFor(state),
  });

  state.totals.queries += 1;
  statFor(state, user).queries += 1;

  let millis = 0;
  let dropped = false;
  let sent = 0;

  for (const step of result.steps) {
    if (step.from === step.to) continue;
    bumpEdge(state, step.from, step.to);
    if (step.kind !== "query") continue;
    if (step.to === resolver) {
      millis += RTT.local;
      continue;
    }
    sent += 1;
    const server = statFor(state, step.to);
    server.queries += 1;
    server.window += 1;
    millis += rttFor(step.to);

    const ceiling = state.config.capacity[step.to];
    if (ceiling === undefined || ceiling <= 0) continue;
    // Judged against last window's rate, so the order queries run inside a
    // window cannot decide which of them survives.
    if (server.rate > ceiling * DROP_FACTOR) {
      server.drops += 1;
      dropped = true;
      break;
    }
    millis += Math.max(0, server.rate / ceiling - 1) * QUEUE_MS;
  }

  if (dropped) {
    if (before !== undefined) {
      cache.clear();
      for (const [key, entry] of before) cache.set(key, entry);
    }
    state.totals.dropped += 1;
    state.totals.failed += 1;
    sample(state.latency, TIMEOUT_MS);
    return;
  }

  // Nothing left the resolver, so the hierarchy above it did no work at all.
  if (sent === 0) state.totals.cached += 1;
  if (result.outcome === "answered") state.totals.answered += 1;
  else state.totals.failed += 1;
  // Believed the attacker — either caught the forgery live, or asked the
  // machine its resolver was talked into trusting some queries ago. A
  // discarded forgery is not a lie served, which is why "rejected" is out.
  if (result.steps.some((s) => s.kind === "forged")) state.totals.forged += 1;
  // Counted from what the user was handed, not from who they spoke to. Most
  // victims never touch the attacker at all: the lie is already in their
  // resolver's memory, and being served it is indistinguishable from being
  // served the truth. Missing them would undercount the damage by an order
  // of magnitude and hide the entire reason cache poisoning matters.
  const touched = result.steps.some(
    (s) => s.from === ATTACKER && s.kind !== "rejected",
  );
  const served = result.answer.some((r) => r.data === ATTACKER_ADDRESS);
  if (touched || served) state.totals.lied += 1;

  sample(state.latency, millis);

  const first = result.steps.find((s) => s.from !== s.to && s.to !== resolver);
  if (first !== undefined && state.packets.length < PACKET_LIMIT) {
    state.packets.push({ from: first.from, to: first.to, kind: first.kind });
  }
}

function insert(pending: Arrival[], arrival: Arrival): void {
  let at = pending.length;
  while (at > 0 && (pending[at - 1]?.at ?? 0) > arrival.at) at -= 1;
  pending.splice(at, 0, arrival);
}

function schedule(state: SimState, user: NodeId, from: number): void {
  const at = from + expDelay(state.load, state.config.ratePerUser);
  if (!isFinite(at)) return;
  insert(state.pending, { at, user });
}

export function createSim(config: SimConfig): SimState {
  const safe = withinBudget(config);
  const topology = buildTopology(safe);
  const state: SimState = {
    config: safe,
    topology,
    load: mulberry32(safe.seed),
    // A second, unrelated stream from the same seed.
    chance: mulberry32(safe.seed ^ 0x9e3779b9),
    now: 0,
    caches: new Map(),
    nodes: new Map(),
    edges: new Map(),
    totals: emptyTotals(),
    latency: createSamples(),
    pending: [],
    nextWindow: WINDOW,
    packets: [],
  };
  for (const id of topology.tiers[3] ?? []) state.caches.set(id, new Map());
  for (const id of topology.tiers[4] ?? []) schedule(state, id, 0);
  return state;
}

// The one place the browser's limit is enforced. It lowers the rate rather
// than the user count, because the crowd is the picture and the rate is not.
export function withinBudget(config: SimConfig): SimConfig {
  const ceiling = MAX_EVENTS / Math.max(1, config.users);
  const rate = Math.min(config.ratePerUser, ceiling);
  return { ...config, ratePerUser: Math.max(LIMITS.ratePerUser.min, rate) };
}

// Advance to a moment in simulated time. Every arrival between here and there
// happens, in order, whether that is one frame's worth or ten minutes'.
export function stepTo(state: SimState, to: number): void {
  for (;;) {
    const next = state.pending[0];
    if (next === undefined || next.at > to) break;
    while (state.nextWindow <= next.at) closeWindow(state);
    state.now = next.at;
    state.pending.shift();
    runQuery(state, next.user);
    schedule(state, next.user, state.now);
  }
  while (state.nextWindow <= to) closeWindow(state);
  state.now = to;
}

// A knob moved. The run continues — counters keep their history — but the
// world it is running in is rebuilt around what changed.
export function reconfigure(state: SimState, next: SimConfig): void {
  const safe = withinBudget(next);
  const flush = safe.ttl !== state.config.ttl;
  state.config = safe;
  state.topology = buildTopology(safe);

  const resolvers = new Set(state.topology.tiers[3] ?? []);
  for (const id of state.caches.keys()) {
    if (!resolvers.has(id)) state.caches.delete(id);
  }
  for (const id of resolvers) {
    // Entries hold an absolute expiry worked out under the old TTL, so
    // keeping them would make the readout describe a world that is gone.
    if (flush || !state.caches.has(id)) state.caches.set(id, new Map());
  }

  const users = new Set(state.topology.tiers[4] ?? []);
  state.pending = state.pending.filter((a) => users.has(a.user));
  const waiting = new Set(state.pending.map((a) => a.user));
  for (const id of users) {
    if (!waiting.has(id)) schedule(state, id, state.now);
  }
  for (const id of state.nodes.keys()) {
    if (state.topology.nodes[id] === undefined) state.nodes.delete(id);
  }
}

export const hitRate = (state: SimState): number =>
  state.totals.queries === 0 ? 0 : state.totals.cached / state.totals.queries;

export const percentile = (state: SimState, p: number): number =>
  quantile(state.latency, p);

// Read once and cleared: a packet is drawn or it is missed, never queued up
// to arrive late.
export function drainPackets(state: SimState): SampledPacket[] {
  const taken = state.packets;
  state.packets = [];
  return taken;
}
