import { answerFor, remember, startZone, type Cache } from "./cache.js";
import { deepest, fqdn, isWithin } from "./names.js";
import type {
  DNSRecord,
  NodeId,
  Question,
  ResolutionResult,
  ResolutionStep,
  Response,
  Zone,
} from "./types.js";

export const STUB: NodeId = "stub";
export const RECURSOR: NodeId = "recursor";

const MAX_HOPS = 10;

// The delegation a zone holds for the deepest child enclosing the question.
function findDelegation(zone: Zone, name: string): DNSRecord[] {
  const owners = zone.records
    .filter((r) => r.type === "NS" && r.name !== zone.origin)
    .map((r) => r.name)
    .filter((owner) => owner === name || isWithin(name, owner));

  const owner = deepest(owners);
  if (owner === undefined) return [];
  return zone.records.filter((r) => r.type === "NS" && r.name === owner);
}

// Glue: the parent must ship addresses for nameservers inside the child zone,
// or the referral is unusable — you would need the child to find the child.
function glueFor(zone: Zone, delegation: DNSRecord[]): DNSRecord[] {
  const targets = new Set(delegation.map((r) => r.data));
  return zone.records.filter((r) => r.type === "A" && targets.has(r.name));
}

// What one nameserver says when asked. Answer, referral, or NXDOMAIN — a
// nameserver never goes and looks something up for you.
export function respond(zone: Zone, q: Question): Response {
  // Delegation outranks a local match. A parent holds NS records for its
  // children, but they are the referral, not an authoritative answer — so
  // "NS anu.edu.au." must still travel past the TLD that delegated it.
  const delegation = findDelegation(zone, q.name);
  if (delegation.length > 0) {
    return {
      kind: "referral",
      records: [...delegation, ...glueFor(zone, delegation)],
    };
  }

  const answer = zone.records.filter(
    (r) => r.name === q.name && r.type === q.type,
  );
  if (answer.length > 0) return { kind: "answer", records: answer };

  // An alias answers for every type. The server cannot give you the record
  // you asked for, only the name you should have asked about.
  const alias = zone.records.filter(
    (r) => r.type === "CNAME" && r.name === q.name,
  );
  if (alias.length > 0) return { kind: "cname", records: alias };

  // "No phone number" and "no such person" are different answers, and DNS
  // says so: a name that exists with no record of this type is NODATA, and
  // only a name the zone has never heard of is NXDOMAIN. Either way the SOA
  // comes back, because either way the emptiness is what gets cached.
  const exists = zone.records.some((r) => r.name === q.name);
  return {
    kind: exists ? "nodata" : "nxdomain",
    records: zone.records.filter((r) => r.type === "SOA"),
  };
}

function zoneNamed(zones: Zone[], origin: string): Zone | undefined {
  return zones.find((z) => z.origin === origin);
}

function describeReferral(records: DNSRecord[]): string {
  const owner = records[0]?.name ?? "?";
  return `Not mine. Ask the nameservers for ${owner}`;
}

function noteFor(response: Response, q: Question, origin: string): string {
  switch (response.kind) {
    case "referral":
      return describeReferral(response.records);
    case "answer":
      return `Authoritative: ${response.records.map((r) => r.data).join(", ")}`;
    case "cname":
      return `${q.name} is really ${response.records[0]?.data ?? "?"} — start again`;
    case "nodata":
      return `${q.name} exists, but has no ${q.type} record`;
    case "nxdomain":
      return `No such name below ${origin}`;
  }
}

// What the resolver hands back to the client, which is the only message the
// client ever sees — the whole walk is invisible from where it is standing.
function finalNote(
  q: Question,
  outcome: ResolutionResult["outcome"],
  answer: DNSRecord[],
): string {
  if (outcome === "answered") {
    return `${q.name} is at ${answer.map((r) => r.data).join(", ")}`;
  }
  if (outcome === "nodata") {
    return `${q.name} exists, but has no ${q.type} record`;
  }
  return `${q.name} does not exist`;
}

// Everything the walk needs beyond the zones themselves. All optional: a
// resolver with no memory and no notion of time is exactly level 1.
export interface ResolveOptions {
  cache?: Cache;
  // Seconds, supplied rather than read from the clock, so expiry is
  // reproducible in a test and steerable by the visitor.
  now?: number;
  client?: NodeId;
}

// The recursor's walk: start as far down the tree as it already knows about,
// and follow referrals until some server is authoritative. The client never
// does any of this.
export function resolve(
  q: Question,
  zones: Zone[],
  options: ResolveOptions = {},
): ResolutionResult {
  const { cache, now = 0, client = STUB } = options;
  const question: Question = { name: fqdn(q.name), type: q.type };
  const steps: ResolutionStep[] = [];

  steps.push({
    from: client,
    to: RECURSOR,
    kind: "query",
    records: [],
    note: `Where is ${question.name}? (${question.type})`,
  });

  // A message the resolver sends to itself: same node at both ends, so the
  // packet visibly goes nowhere.
  const recall = (records: DNSRecord[], note: string): void => {
    steps.push({ from: RECURSOR, to: RECURSOR, kind: "cached", records, note });
  };

  // Where the walk can start. Anything above a cached delegation is skipped,
  // which is the whole reason the root is barely touched in practice.
  const enter = (name: string): Zone | undefined => {
    const origin = cache === undefined ? "." : startZone(cache, name, now);
    if (origin !== ".") {
      recall(
        cache?.get(`${origin}|NS`)?.records ?? [],
        `Already know who serves ${origin} — resuming there`,
      );
    }
    return zoneNamed(zones, origin);
  };

  let zone = enter(question.name);
  let outcome: ResolutionResult["outcome"] = "nxdomain";
  let answer: DNSRecord[] = [];

  // The question can change mid-walk: an alias replaces the name being asked
  // about, and `seen` stops two aliases pointing at each other forever.
  let current: Question = { ...question };
  const seen = new Set<string>([question.name]);

  for (let hop = 0; hop < MAX_HOPS && zone !== undefined; hop += 1) {
    const hit = cache === undefined ? undefined : answerFor(cache, current, now);
    if (hit !== undefined) {
      recall(hit.records, `${current.name} is already known — nothing is sent`);
      if (hit.kind === "answer") {
        outcome = "answered";
        answer = hit.records;
        break;
      }
      if (hit.kind === "nxdomain") break;
      const known = hit.records[0]?.data;
      if (known === undefined || seen.has(known)) break;
      seen.add(known);
      current = { name: known, type: current.type };
      zone = enter(known);
      continue;
    }

    const server = zone.server;

    steps.push({
      from: RECURSOR,
      to: server,
      kind: "query",
      records: [],
      note: `${current.type} record for ${current.name}?`,
      zone: zone.origin,
    });

    const response = respond(zone, current);
    if (cache !== undefined) remember(cache, current, response, now);
    steps.push({
      from: server,
      to: RECURSOR,
      kind: response.kind,
      records: response.records,
      zone: zone.origin,
      note: noteFor(response, current, zone.origin),
    });

    if (response.kind === "answer") {
      outcome = "answered";
      answer = response.records;
      break;
    }
    if (response.kind === "nxdomain" || response.kind === "nodata") {
      outcome = response.kind;
      break;
    }

    // An alias sends the recursor back to the root: it now has a different
    // name to find, and knows nothing about where that one lives.
    if (response.kind === "cname") {
      const alias = response.records[0]?.data;
      if (alias === undefined || seen.has(alias)) break;
      seen.add(alias);
      current = { name: alias, type: current.type };
      zone = enter(alias);
      continue;
    }

    const nextOrigin = response.records[0]?.name;
    zone = nextOrigin === undefined ? undefined : zoneNamed(zones, nextOrigin);
  }

  steps.push({
    from: RECURSOR,
    to: client,
    kind: outcome === "answered" ? "answer" : outcome,
    records: answer,
    note: finalNote(question, outcome, answer),
  });

  return { question, steps, outcome, answer };
}
