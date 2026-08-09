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

// Only name-valued rdata gets the root dot. An address is not a name.
const NAME_VALUED = new Set<RecordType>(["NS", "CNAME", "MX", "SOA"]);

function toRecords(response: DohResponse, want: RecordType): DNSRecord[] {
  return (response.Answer ?? [])
    .filter((r) => TYPE_NAMES[r.type] === want)
    .map((r) => ({
      name: fqdn(r.name),
      type: want,
      ttl: r.TTL,
      data: NAME_VALUED.has(want) ? fqdn(r.data) : r.data,
    }));
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
  fetchJson: FetchJson = defaultFetchJson,
): Promise<LiveZones> {
  const target = fqdn(name);
  const delegations = await delegationsFor(suffixesOf(target), fetchJson);
  const cuts = ["."].concat(
    suffixesOf(target).filter((s) => delegations.has(s)),
  );

  // Real answers often arrive via a CNAME, so the A record is named for the
  // alias, not the question. L1 shows what the stub consumes; the chain
  // itself is L2's subject.
  const answers = toRecords(await fetchJson(query(target, "A")), "A").map(
    (record) => ({ ...record, name: target }),
  );
  const zones: Zone[] = [];

  for (const [index, origin] of cuts.entries()) {
    const child = cuts[index + 1];
    const delegation = child === undefined ? [] : (delegations.get(child) ?? []);
    const records =
      child === undefined
        ? answers
        : [...delegation, ...(await glueFor(delegation, fetchJson))];

    zones.push({ origin, server: seatFor(index, cuts.length), records });
  }

  return { zones, cuts };
}
