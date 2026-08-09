import type { CacheEntry } from "../dns/cache.js";
import type { DNSRecord, RecordType, StepKind } from "../dns/types.js";

// Records are the level's subject, so they are annotated rather than
// tabulated. Each explanation appears the first time it is needed in a run
// and is dropped after that, the way prose introduces a term once.

export type Role =
  | "delegation"
  | "glue"
  | "answer"
  | "alias"
  | "denial"
  | "remembered";

// What the record is doing in this message. The same NS record is a
// delegation coming from a parent and an answer coming from the zone itself.
export function roleOf(kind: StepKind, record: DNSRecord): Role {
  switch (kind) {
    case "referral":
      return record.type === "NS" ? "delegation" : "glue";
    case "cached":
      return "remembered";
    case "cname":
      return "alias";
    case "nxdomain":
      return "denial";
    default:
      return "answer";
  }
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

function plural(count: number, unit: string): string {
  const rounded = Math.round(count);
  return `${String(rounded)} ${unit}${rounded === 1 ? "" : "s"}`;
}

// Seconds are how DNS stores a TTL and not how anyone thinks about one.
export function humanTtl(seconds: number): string {
  if (seconds < MINUTE) return plural(seconds, "second");
  if (seconds < HOUR) return plural(seconds / MINUTE, "minute");
  if (seconds < DAY) return plural(seconds / HOUR, "hour");
  return plural(seconds / DAY, "day");
}

// One source for what a type is, so the picker's description and the note
// beside the record itself can never drift apart.
export const glossFor = (type: RecordType): string => TYPE_GLOSS[type];

const TYPE_GLOSS: Record<RecordType, string> = {
  A: "An address — the end of the road, and the only kind of answer you can open a connection to.",
  AAAA: "An IPv6 address. Same job as an A record, in 128 bits instead of 32.",
  NS: "Names a server authoritative for a zone. It tells you who to ask, never where anything is.",
  CNAME:
    "An alias: not an address but another name, which has to be looked up from scratch.",
  MX: "Names a domain's mail server, prefixed with a priority. DNS was never only about the web.",
  SOA: "Start of authority — the zone's own paperwork, and what a server hands back for a name that does not exist.",
};

const ROLE_NOTE: Record<Role, string> = {
  delegation:
    "The parent does not know the answer. It knows which servers do, and that is all a referral ever is.",
  glue: "This nameserver lives inside the zone it serves, so its address travels with the referral. Without it you would have to ask the zone where the zone's own nameserver is.",
  answer:
    "Authoritative: this server is responsible for the name itself, so the walk stops here.",
  alias:
    "The name you asked about is a signpost, not a destination. The resolver drops its progress and starts again at the root.",
  denial:
    "No such name. The SOA is what gets cached, so the absence is remembered exactly as an answer would be.",
  remembered:
    "Out of the resolver's memory rather than off the network. Nothing was sent, nobody was asked, and it stays true only until the TTL runs out.",
};

// Everything already explained in this run. Shared across a walk's steps so
// the first referral teaches and the third one simply reads.
export type Seen = Set<string>;

const COLUMNS = ["Role", "Name", "TTL", "Type", "Data"];

function cell(row: HTMLTableRowElement, text: string, klass?: string): void {
  const td = row.insertCell();
  td.textContent = text;
  if (klass !== undefined) td.className = klass;
}

function annotate(
  record: DNSRecord,
  role: Role,
  seen: Seen,
): string[] {
  const notes = [
    seen.has(`type:${record.type}`) ? undefined : TYPE_GLOSS[record.type],
    seen.has(`role:${role}`) ? undefined : ROLE_NOTE[role],
  ].filter((note) => note !== undefined);

  seen.add(`type:${record.type}`);
  seen.add(`role:${role}`);
  return notes;
}

const CACHE_COLUMNS = ["Holds", "Name", "Type", "Expires in"];

// What the resolver currently remembers. The graph can only show the
// consequences of a cache; this is the cache itself, counting down.
export function cacheTable(held: CacheEntry[], now: number): HTMLElement {
  const scroller = document.createElement("div");
  scroller.className = "records-scroll";

  if (held.length === 0) {
    const empty = document.createElement("p");
    empty.className = "cache-empty";
    empty.textContent =
      "Empty. Every lookup starts at the root until something is remembered.";
    scroller.append(empty);
    return scroller;
  }

  const table = document.createElement("table");
  table.className = "records";
  scroller.append(table);

  const head = table.createTHead().insertRow();
  for (const column of CACHE_COLUMNS) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = column;
    head.append(th);
  }

  const body = table.createTBody();
  for (const entry of held) {
    const record = entry.records[0];
    const role = record === undefined ? "answer" : roleOf(entry.kind, record);
    const row = body.insertRow();
    row.dataset.role = role;
    cell(row, role, "record-role");
    cell(row, entry.name);
    cell(row, entry.type, "record-type");
    cell(row, humanTtl(entry.expires - now), "record-ttl");
  }

  return scroller;
}

export function recordTable(
  records: DNSRecord[],
  kind: StepKind,
  seen: Seen,
): HTMLElement {
  // Wrapped rather than made scrollable itself: `display: block` on a table
  // costs its semantics, and the phone viewport is marked in full.
  const scroller = document.createElement("div");
  scroller.className = "records-scroll";
  const table = document.createElement("table");
  table.className = "records";
  scroller.append(table);

  const head = table.createTHead().insertRow();
  for (const column of COLUMNS) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = column;
    head.append(th);
  }

  const body = table.createTBody();
  for (const record of records) {
    const role = roleOf(kind, record);
    const row = body.insertRow();
    row.dataset.role = role;

    cell(row, role, "record-role");
    cell(row, record.name);
    cell(row, humanTtl(record.ttl), "record-ttl");
    cell(row, record.type, "record-type");
    cell(row, record.data);

    const notes = annotate(record, role, seen);
    if (notes.length === 0) continue;

    const noteRow = body.insertRow();
    noteRow.className = "record-annotation";
    const holder = noteRow.insertCell();
    holder.colSpan = COLUMNS.length;
    for (const note of notes) {
      const line = document.createElement("p");
      line.textContent = note;
      holder.append(line);
    }
  }

  return scroller;
}
