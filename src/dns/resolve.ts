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
function isWithin(name: string, origin: string): boolean {
  if (name === origin) return false;
  if (origin === ".") return true;
  return name.endsWith(`.${origin}`) || name.endsWith(origin);
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

function zoneOf(zones: Zone[], server: NodeId): Zone | undefined {
  return zones.find((z) => z.server === server);
}

function serverForZone(zones: Zone[], origin: string): Zone | undefined {
  return zones.find((z) => z.origin === origin);
}

function describeReferral(records: DNSRecord[]): string {
  const owner = records[0]?.name ?? "?";
  return `Not mine. Ask the nameservers for ${owner}`;
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

  let current = serverForZone(zones, ".")?.server;
  let outcome: ResolutionResult["outcome"] = "nxdomain";
  let answer: DNSRecord[] = [];

  for (let hop = 0; hop < MAX_HOPS && current !== undefined; hop += 1) {
    const zone = zoneOf(zones, current);
    if (zone === undefined) break;

    steps.push({
      from: RECURSOR,
      to: current,
      kind: "query",
      records: [],
      note: `${question.type} record for ${question.name}?`,
    });

    const response = respond(zone, question);
    steps.push({
      from: current,
      to: RECURSOR,
      kind: response.kind,
      records: response.records,
      note:
        response.kind === "referral"
          ? describeReferral(response.records)
          : response.kind === "answer"
            ? `Authoritative: ${response.records.map((r) => r.data).join(", ")}`
            : `No such name — ${question.name} does not exist`,
    });

    if (response.kind === "answer") {
      outcome = "answered";
      answer = response.records;
      break;
    }
    if (response.kind === "nxdomain") break;

    const nextOrigin = response.records[0]?.name;
    current =
      nextOrigin === undefined
        ? undefined
        : serverForZone(zones, nextOrigin)?.server;
  }

  steps.push({
    from: RECURSOR,
    to: STUB,
    kind: outcome === "answered" ? "answer" : "nxdomain",
    records: answer,
    note:
      outcome === "answered"
        ? `${question.name} is at ${answer.map((r) => r.data).join(", ")}`
        : `${question.name} does not exist`,
  });

  return { question, steps, outcome, answer };
}
