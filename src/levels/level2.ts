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

// Records level 1 never surfaces. The alias already lives in level 1's zone,
// on www, so nothing level 1 taught changes meaning here — it only becomes
// askable once a type picker exists.
const EXTRA: Record<string, DNSRecord[]> = {
  "anu.edu.au.": [
    // A zone's apex NS set is the delegation, restated by the zone that owns
    // it. Asking for it is how you see the tree's own wiring.
    { name: "anu.edu.au.", type: "NS", ttl: 86400, data: "ns1.anu.edu.au." },
    { name: "anu.edu.au.", type: "NS", ttl: 86400, data: "una.anu.edu.au." },
    { name: "una.anu.edu.au.", type: "A", ttl: 86400, data: "150.203.22.28" },
    // The real exchange sits outside the zone entirely — mail for anu.edu.au
    // is handled by Microsoft, which an invented mail.anu.edu.au would hide.
    {
      name: "anu.edu.au.",
      type: "MX",
      ttl: 3600,
      data: "10 anu-edu-au.mail.protection.outlook.com.",
    },
  ],
  "google.com.": [
    {
      name: "google.com.",
      type: "MX",
      ttl: 300,
      data: "10 smtp.google.com.",
    },
    { name: "smtp.google.com.", type: "A", ttl: 300, data: "74.125.68.26" },
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
  clients: ["stub"],
  caching: false,
  simulated: false,
  zones: LEVEL2_ZONES,
  knownNames: LEVEL2_NAMES,
  defaultQuery: "anu.edu.au",
};
