import { fqdn } from "./resolve.js";
import type { DNSRecord, RecordType, Zone } from "./types.js";

// Real delegation data over DNS-over-HTTPS. A browser cannot observe
// referrals — a recursor does that walk and discards the steps — so we ask
// which suffixes are zone cuts and rebuild the chain from real records.
// The names, addresses and TTLs are real; the sequence is a reconstruction,
// and the UI says so.

const ENDPOINT = "https://dns.google/resolve";
const TIMEOUT_MS = 3000;
const MAX_NS_PER_ZONE = 2;
// Real alias chains are short. Two hops covers www → CDN without a slow page.
const MAX_ALIAS_HOPS = 2;

const TYPE_NAMES: Record<number, RecordType> = {
  1: "A",
  2: "NS",
  5: "CNAME",
  6: "SOA",
  15: "MX",
  28: "AAAA",
};

interface DohRecord {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

export interface DohResponse {
  Status: number;
  Answer?: DohRecord[];
  Authority?: DohRecord[];
}

export type FetchJson = (url: string) => Promise<DohResponse>;

export interface LiveZones {
  zones: Zone[];
  cuts: string[];
}

async function defaultFetchJson(url: string): Promise<DohResponse> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/dns-json" },
  });
  if (!response.ok) throw new Error(`DoH ${String(response.status)}`);
  return (await response.json()) as DohResponse;
}

const query = (name: string, type: RecordType): string =>
  `${ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}`;

// Only name-valued rdata gets the root dot. An address is not a name, and MX
// and SOA rdata are compound, so their names already carry their own dots.
const NAME_VALUED = new Set<RecordType>(["NS", "CNAME"]);

function toRecords(
  response: DohResponse,
  want: RecordType,
  section: "Answer" | "Authority" = "Answer",
): DNSRecord[] {
  return (response[section] ?? [])
    .filter((r) => TYPE_NAMES[r.type] === want)
    .map((r) => ({
      name: fqdn(r.name),
      type: want,
      ttl: r.TTL,
      data: NAME_VALUED.has(want) ? fqdn(r.data) : r.data,
    }));
}

// Two chains can share zones — an alias usually lives near its target, and
// both walks start at the same root.
function mergeZones(base: Zone[], extra: Zone[]): Zone[] {
  const key = (r: DNSRecord): string => `${r.name}|${r.type}|${r.data}`;
  const byOrigin = new Map(base.map((z) => [z.origin, z]));

  for (const zone of extra) {
    const existing = byOrigin.get(zone.origin);
    if (existing === undefined) {
      byOrigin.set(zone.origin, zone);
      continue;
    }
    const seen = new Set(existing.records.map(key));
    byOrigin.set(zone.origin, {
      ...existing,
      records: [
        ...existing.records,
        ...zone.records.filter((r) => !seen.has(key(r))),
      ],
    });
  }
  return [...byOrigin.values()];
}

// Every suffix of the name, root first, including the name itself — an apex
// like google.com. is a zone cut, and dropping it would seat its address in
// the TLD's zone and skip a delegation that really happened.
export function suffixesOf(name: string): string[] {
  const labels = fqdn(name).split(".").filter(Boolean);
  const out = ["."];
  for (let i = labels.length - 1; i >= 0; i -= 1) {
    out.push(`${labels.slice(i).join(".")}.`);
  }
  return out;
}

// A suffix is a zone cut when its own nameservers answer for it.
async function delegationsFor(
  suffixes: string[],
  fetchJson: FetchJson,
): Promise<Map<string, DNSRecord[]>> {
  const found = new Map<string, DNSRecord[]>();
  const lookups = suffixes
    .filter((s) => s !== ".")
    .map(async (suffix) => {
      const ns = toRecords(await fetchJson(query(suffix, "NS")), "NS");
      if (ns.length > 0) found.set(suffix, ns.slice(0, MAX_NS_PER_ZONE));
    });
  await Promise.all(lookups);
  return found;
}

async function glueFor(
  delegation: DNSRecord[],
  fetchJson: FetchJson,
): Promise<DNSRecord[]> {
  const glue = await Promise.all(
    delegation.map(async (ns) => toRecords(await fetchJson(query(ns.data, "A")), "A")),
  );
  return glue.flat();
}

// Seats, not machines: the graph has one TLD and one authoritative node, and
// a deep name simply visits the authoritative seat more than once.
function seatFor(index: number, total: number): string {
  if (index === 0) return "root";
  if (index === total - 1) return "auth";
  return index === 1 ? "tld" : "auth";
}

export async function buildZones(
  name: string,
  type: RecordType = "A",
  fetchJson: FetchJson = defaultFetchJson,
  hops = MAX_ALIAS_HOPS,
): Promise<LiveZones> {
  const target = fqdn(name);
  const delegations = await delegationsFor(suffixesOf(target), fetchJson);
  const cuts = ["."].concat(
    suffixesOf(target).filter((s) => delegations.has(s)),
  );

  const response = await fetchJson(query(target, type));
  const answers = toRecords(response, type);
  // An alias answers for any type but its own, and NXDOMAIN carries the SOA
  // of the zone that denied the name, which is what sets the negative TTL.
  const aliases = type === "CNAME" ? [] : toRecords(response, "CNAME");
  const denial = toRecords(response, "SOA", "Authority");

  const zones: Zone[] = [];
  for (const [index, origin] of cuts.entries()) {
    const child = cuts[index + 1];
    const delegation = child === undefined ? [] : (delegations.get(child) ?? []);
    const records =
      child === undefined
        ? [...answers, ...aliases, ...denial]
        : [...delegation, ...(await glueFor(delegation, fetchJson))];

    zones.push({ origin, server: seatFor(index, cuts.length), records });
  }

  // Chase the alias only when its own answer did not come back with it —
  // an alias inside the same zone is already resolvable from these records.
  const alias = aliases[0]?.data;
  if (alias === undefined || hops <= 0) return { zones, cuts };
  if (answers.some((r) => r.name === alias)) return { zones, cuts };

  const chased = await buildZones(alias, type, fetchJson, hops - 1);
  return { zones: mergeZones(zones, chased.zones), cuts };
}
