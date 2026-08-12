import type { DNSRecord, NodeId, Zone } from "../dns/types.js";
import type { NodeLabel, SimConfig } from "./types.js";

// Counts become a network. Five tiers, one root, and the visitor decides how
// wide the lower three are — so the funnel that keeps the root alive is a
// consequence of arithmetic rather than a shape somebody drew.

export const ROOT: NodeId = "root";
export const TLD: NodeId = "tld";

export const TLD_ORIGIN = "au.";

// Real registrations, so nothing here teaches a name that falls over the
// moment somebody looks it up. There are eight because the graph stops being
// readable past that, which is also why no synthetic names are needed.
export const SITE_NAMES: readonly string[] = [
  "anu.edu.au.",
  "unsw.edu.au.",
  "usyd.edu.au.",
  "csiro.au.",
  "abc.net.au.",
  "bom.gov.au.",
  "monash.edu.au.",
  "uq.edu.au.",
];

// Addresses from the ranges reserved for documentation (RFC 5737, RFC 3849).
// The zone names are real but their nameservers here are not, and an address
// that can never belong to a real host is a more honest placeholder than a
// plausible-looking one.
const ipv4 = (index: number): string => `192.0.2.${String(index + 10)}`;
const ipv6 = (index: number): string => `2001:db8::${String(index + 10)}`;

export interface Topology {
  // Top to bottom: root, TLD, authorities, resolvers, users.
  tiers: NodeId[][];
  nodes: Record<NodeId, NodeLabel>;
  edges: [NodeId, NodeId][];
  zones: Zone[];
  // Which zone each authority machine is authoritative for.
  zoneOf: Map<NodeId, string>;
  // Which resolver a user asks. A user only ever talks to this one.
  resolverOf: Map<NodeId, NodeId>;
  // The pool of names the users draw their questions from.
  names: string[];
}

export const userId = (index: number): NodeId => `u${String(index)}`;
export const resolverId = (index: number): NodeId => `res${String(index)}`;
export const authId = (index: number): NodeId => `auth${String(index)}`;

export const nsOf = (origin: string): string => `ns1.${origin}`;

// A zone name without its trailing dot, for labels. "anu.edu.au." reads as
// "anu.edu.au" to everyone who is not a nameserver.
export const bare = (origin: string): string => origin.replace(/\.$/, "");

function rootZone(ttl: number): Zone {
  return {
    origin: ".",
    server: ROOT,
    records: [
      { name: TLD_ORIGIN, type: "NS", ttl, data: nsOf(TLD_ORIGIN) },
      { name: nsOf(TLD_ORIGIN), type: "A", ttl, data: ipv4(0) },
      { name: ".", type: "SOA", ttl, data: "a.root-servers.net." },
    ],
  };
}

// The registry: it holds a delegation for every site and answers for none of
// them. Its records are all pointers, which is what a TLD server is.
function tldZone(origins: string[], ttl: number): Zone {
  const delegations = origins.flatMap((origin, index): DNSRecord[] => [
    { name: origin, type: "NS", ttl, data: nsOf(origin) },
    // Glue: the nameserver lives inside the zone it serves, so the parent has
    // to ship its address or the referral is unusable.
    { name: nsOf(origin), type: "A", ttl, data: ipv4(index + 1) },
  ]);
  return {
    origin: TLD_ORIGIN,
    server: TLD,
    records: [
      ...delegations,
      { name: TLD_ORIGIN, type: "SOA", ttl, data: nsOf(TLD_ORIGIN) },
    ],
  };
}

// One site. www is an alias rather than an address, because that is what makes
// a resolver restart mid-walk, and it is worth having in the query pool.
function siteZone(origin: string, index: number, ttl: number): Zone {
  const address = ipv4(index + 1);
  return {
    origin,
    server: authId(index),
    ns: nsOf(origin),
    records: [
      { name: origin, type: "A", ttl, data: address },
      { name: origin, type: "AAAA", ttl, data: ipv6(index + 1) },
      { name: origin, type: "MX", ttl, data: `10 mail.${origin}` },
      { name: `www.${origin}`, type: "CNAME", ttl, data: `web.${origin}` },
      { name: `web.${origin}`, type: "A", ttl, data: address },
      { name: origin, type: "SOA", ttl, data: nsOf(origin) },
    ],
  };
}

export function buildTopology(config: SimConfig): Topology {
  const origins = SITE_NAMES.slice(0, config.authorities);
  const auths = origins.map((_, index) => authId(index));
  const resolvers = Array.from({ length: config.resolvers }, (_, i) =>
    resolverId(i),
  );
  const users = Array.from({ length: config.users }, (_, i) => userId(i));

  const nodes: Record<NodeId, NodeLabel> = {
    [ROOT]: { title: ".", role: "root · knows only the TLDs" },
    [TLD]: { title: bare(TLD_ORIGIN), role: "registry · delegates only" },
  };
  for (const [index, origin] of origins.entries()) {
    nodes[authId(index)] = {
      title: bare(origin),
      role: "authoritative · answers",
    };
  }
  for (const [index, id] of resolvers.entries()) {
    nodes[id] = {
      title: `Resolver ${String(index + 1)}`,
      role: "recursive · caches",
    };
  }
  for (const [index, id] of users.entries()) {
    nodes[id] = { title: `Machine ${String(index + 1)}`, role: "asks once" };
  }

  // Round robin, so growing either tier keeps the load even and the picture
  // balanced. Deterministic: user 7 always lands on the same resolver.
  const resolverOf = new Map<NodeId, NodeId>();
  const edges: [NodeId, NodeId][] = [];
  for (const [index, id] of users.entries()) {
    const resolver = resolvers[index % resolvers.length] ?? resolvers[0] ?? "";
    resolverOf.set(id, resolver);
    edges.push([id, resolver]);
  }
  // Every resolver may reach every server. Which of those edges it actually
  // uses is what the cache decides, and that is the thing being watched.
  for (const resolver of resolvers) {
    edges.push([resolver, ROOT], [resolver, TLD]);
    for (const auth of auths) edges.push([resolver, auth]);
  }

  const zoneOf = new Map<NodeId, string>();
  for (const [index, origin] of origins.entries()) {
    zoneOf.set(authId(index), origin);
  }

  return {
    tiers: [[ROOT], [TLD], auths, resolvers, users],
    nodes,
    edges,
    zones: [
      rootZone(config.ttl),
      tldZone([...origins], config.ttl),
      ...origins.map((origin, index) => siteZone(origin, index, config.ttl)),
    ],
    zoneOf,
    resolverOf,
    names: origins.flatMap((origin) => [`www.${origin}`, origin]),
  };
}
