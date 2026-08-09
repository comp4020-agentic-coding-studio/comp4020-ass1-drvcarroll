import type { DNSRecord, Zone } from "../dns/types.js";
import type { LevelConfig } from "./types.js";
import {
  DEFERRED_EDGES,
  EDGES,
  NODE_LABELS,
  POSITIONS,
  VIEWBOX,
  ZONES,
} from "./level1.js";

// Level 2 keeps level 1's graph and adds one node. MX is the only record type
// whose answer is a name rather than an address, so it is the honest reason a
// second destination exists: you resolve the answer before you can use it.

export const NODES = {
  ...NODE_LABELS,
  mail: { title: "Mail server", role: "named by an MX record" },
};

// Beside the web server, under your machine — both are places you connect to
// once DNS is done, never places the walk passes through.
// Narrow stacks them between the machine and the resolver, so the servers
// below shift down to leave the resolver's speech box somewhere to go.
const NARROW_DROP = 100;

export const LEVEL2_POSITIONS = {
  wide: {
    ...POSITIONS.wide,
    origin: { x: 80, y: 340 },
    mail: { x: 250, y: 340 },
  },
  narrow: {
    ...Object.fromEntries(
      Object.entries(POSITIONS.narrow).map(([id, point]) => [
        id,
        id === "stub" ? point : { ...point, y: point.y + NARROW_DROP },
      ]),
    ),
    origin: { x: 110, y: 150 },
    mail: { x: 305, y: 150 },
  },
};

export const LEVEL2_EDGES: [string, string][] = [...EDGES, ["stub", "mail"]];

export const LEVEL2_DEFERRED = new Set([...DEFERRED_EDGES, "stub:mail"]);

// Records level 1 never surfaces. The alias is on a name of its own, so
// nothing level 1 already taught changes meaning here.
const EXTRA: Record<string, DNSRecord[]> = {
  "anu.edu.au.": [
    // A zone's apex NS set is the delegation, restated by the zone that owns
    // it. Asking for it is how you see the tree's own wiring.
    { name: "anu.edu.au.", type: "NS", ttl: 86400, data: "ns1.anu.edu.au." },
    { name: "anu.edu.au.", type: "MX", ttl: 3600, data: "10 mail.anu.edu.au." },
    { name: "mail.anu.edu.au.", type: "A", ttl: 3600, data: "130.56.65.20" },
    {
      name: "webmail.anu.edu.au.",
      type: "CNAME",
      ttl: 300,
      data: "terra-web.anu.edu.au.",
    },
    {
      name: "terra-web.anu.edu.au.",
      type: "A",
      ttl: 300,
      data: "130.56.65.113",
    },
  ],
  "google.com.": [
    {
      name: "google.com.",
      type: "MX",
      ttl: 300,
      data: "10 smtp.google.com.",
    },
    { name: "smtp.google.com.", type: "A", ttl: 300, data: "142.250.70.27" },
  ],
};

// Extended, not rewritten: a second hand-written internet would drift from
// the first and say two different things about the same names.
export const LEVEL2_ZONES: Zone[] = ZONES.map((zone) => ({
  ...zone,
  records: [...zone.records, ...(EXTRA[zone.origin] ?? [])],
}));

export const LEVEL2_NAMES = [
  "www.anu.edu.au",
  "anu.edu.au",
  "webmail.anu.edu.au",
  "www.google.com",
  "google.com",
];

// NS and SOA are deliberately absent from `destinations`. Knowing who runs a
// zone tells you nothing you can open a connection to.
export const LEVEL2: LevelConfig = {
  id: "l2",
  title: "Records",
  nodes: NODES,
  viewBox: { ...VIEWBOX, narrow: "0 -60 420 960" },
  positions: LEVEL2_POSITIONS,
  edges: LEVEL2_EDGES,
  deferredEdges: LEVEL2_DEFERRED,
  types: ["A", "MX", "CNAME", "NS", "SOA"],
  destinations: { A: "origin", MX: "mail" },
  zones: LEVEL2_ZONES,
  knownNames: LEVEL2_NAMES,
  defaultQuery: "anu.edu.au",
};
