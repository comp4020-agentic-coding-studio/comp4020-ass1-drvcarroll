import { deepest, isWithin } from "./names.js";
import type { DNSRecord, Question, RecordType, Response } from "./types.js";

// The resolver's memory. What makes DNS survivable at internet scale is not
// that answers are cached — it is that *referrals* are, so the second lookup
// under a domain starts partway down the tree instead of at the root.

export interface CacheEntry {
  name: string;
  type: RecordType;
  records: DNSRecord[];
  kind: Response["kind"];
  // Absolute, so expiry is a comparison rather than a countdown to maintain.
  expires: number;
}

export type Cache = Map<string, CacheEntry>;

const keyOf = (name: string, type: RecordType): string => `${name}|${type}`;

// A set is only usable while all of it is fresh, so it expires with its
// shortest TTL.
function shortestTtl(records: DNSRecord[]): number {
  return records.reduce((least, r) => Math.min(least, r.ttl), Infinity);
}

// A delegation belongs to the child it delegates to, not to the parent that
// handed it over: that is why it can be reused for any name inside the child.
function ownerOf(response: Response, q: Question): Question | undefined {
  if (response.kind === "referral") {
    const ns = response.records.find((r) => r.type === "NS");
    return ns === undefined ? undefined : { name: ns.name, type: "NS" };
  }
  return q;
}

export function remember(
  cache: Cache,
  q: Question,
  response: Response,
  now: number,
): void {
  const owner = ownerOf(response, q);
  const ttl = shortestTtl(response.records);
  if (owner === undefined || !isFinite(ttl)) return;
  cache.set(keyOf(owner.name, owner.type), {
    ...owner,
    records: response.records,
    kind: response.kind,
    expires: now + ttl,
  });
}

const fresh = (entry: CacheEntry, now: number): boolean => entry.expires > now;

// A complete cached response for this exact question — the case where nothing
// leaves the resolver at all.
export function answerFor(
  cache: Cache,
  q: Question,
  now: number,
): CacheEntry | undefined {
  const entry = cache.get(keyOf(q.name, q.type));
  if (entry === undefined || entry.kind === "referral") return undefined;
  return fresh(entry, now) ? entry : undefined;
}

// Where the walk can honestly resume: the deepest zone whose delegation is
// still cached. "." means nothing is known and the root gets asked.
export function startZone(cache: Cache, name: string, now: number): string {
  const known = [...cache.values()]
    .filter((e) => e.kind === "referral" && fresh(e, now))
    .map((e) => e.name)
    .filter((zone) => zone === name || isWithin(name, zone));
  return deepest(known) ?? ".";
}

// Live entries, soonest to expire first. Expired ones are filtered rather
// than deleted, so time stays a parameter and never a side effect.
export function entries(cache: Cache, now: number): CacheEntry[] {
  return [...cache.values()]
    .filter((entry) => fresh(entry, now))
    .sort((a, b) => a.expires - b.expires);
}
