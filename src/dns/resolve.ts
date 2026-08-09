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

// Names are fully qualified internally: "www.anu.edu.au." with the root dot.
export function fqdn(name: string): string {
  return name.endsWith(".") ? name : `${name}.`;
}

function labelCount(name: string): number {
  return name === "." ? 0 : fqdn(name).split(".").filter(Boolean).length;
}

// "anu.edu.au." is within "au." and within "."; nothing is within itself.
// The match is on whole labels — "fooau." is not inside "au.".
function isWithin(name: string, origin: string): boolean {
  if (name === origin) return false;
  if (origin === ".") return true;
  return name.endsWith(`.${origin}`);
}

// The delegation a zone holds for the deepest child enclosing the question.
function findDelegation(zone: Zone, name: string): DNSRecord[] {
  const owners = zone.records
    .filter((r) => r.type === "NS" && r.name !== zone.origin)
    .map((r) => r.name)
    .filter((owner) => owner === name || isWithin(name, owner));

  if (owners.length === 0) return [];

  const deepest = owners.reduce((best, owner) =>
    labelCount(owner) > labelCount(best) ? owner : best,
  );
  return zone.records.filter((r) => r.type === "NS" && r.name === deepest);
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

  const delegation = findDelegation(zone, q.name);
  if (delegation.length > 0) {
    return {
      kind: "referral",
      records: [...delegation, ...glueFor(zone, delegation)],
    };
  }

  return {
    kind: "nxdomain",
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
    case "nxdomain":
      return `No such name below ${origin}`;
  }
}

// The recursor's walk: start at the root and follow referrals until some
// server is authoritative. The client never does any of this.
export function resolve(q: Question, zones: Zone[]): ResolutionResult {
  const question: Question = { name: fqdn(q.name), type: q.type };
  const steps: ResolutionStep[] = [];

  steps.push({
    from: STUB,
    to: RECURSOR,
    kind: "query",
    records: [],
    note: `Where is ${question.name}? (${question.type})`,
  });

  let zone = zoneNamed(zones, ".");
  let outcome: ResolutionResult["outcome"] = "nxdomain";
  let answer: DNSRecord[] = [];

  // The question can change mid-walk: an alias replaces the name being asked
  // about, and `seen` stops two aliases pointing at each other forever.
  let current: Question = { ...question };
  const seen = new Set<string>([question.name]);

  for (let hop = 0; hop < MAX_HOPS && zone !== undefined; hop += 1) {
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
    if (response.kind === "nxdomain") break;

    // An alias sends the recursor back to the root: it now has a different
    // name to find, and knows nothing about where that one lives.
    if (response.kind === "cname") {
      const alias = response.records[0]?.data;
      if (alias === undefined || seen.has(alias)) break;
      seen.add(alias);
      current = { name: alias, type: current.type };
      zone = zoneNamed(zones, ".");
      continue;
    }

    const nextOrigin = response.records[0]?.name;
    zone = nextOrigin === undefined ? undefined : zoneNamed(zones, nextOrigin);
  }

  steps.push({
    from: RECURSOR,
    to: STUB,
    kind: outcome === "answered" ? "answer" : "nxdomain",
    records: answer,
    note:
      outcome === "answered"
        ? `${question.name} is at ${answer.map((r) => r.data).join(", ")}`
        : `${question.name} is not in this miniature internet`,
  });

  return { question, steps, outcome, answer };
}
