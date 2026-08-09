import type { DNSRecord, Zone } from "../dns/types.js";
import type { LevelConfig } from "./types.js";
import {
  LEVEL2_DEFERRED,
  LEVEL2_EDGES,
  LEVEL2_ZONES,
  NODES,
} from "./level2.js";

// Level 3 adds a second machine and the resolver's memory. Nothing about the
// protocol changes; what changes is that the second lookup is not the first,
// which is the only reason the root survives the internet's traffic.

export const LEVEL3_NODES = {
  ...NODES,
  stub2: { title: "Another machine", role: "same resolver as you" },
};

// The two clients share a column, one above the other, because what they
// share is the point: one resolver, one cache, two people benefiting.
export const LEVEL3_POSITIONS = {
  wide: {
    stub: { x: 110, y: 90 },
    stub2: { x: 110, y: 270 },
    recursor: { x: 380, y: 180 },
    root: { x: 720, y: 70 },
    tld: { x: 720, y: 230 },
    auth: { x: 720, y: 390 },
    origin: { x: 80, y: 440 },
    mail: { x: 250, y: 440 },
  },
  narrow: {
    stub: { x: 110, y: 60 },
    stub2: { x: 305, y: 60 },
    origin: { x: 110, y: 150 },
    mail: { x: 305, y: 150 },
    recursor: { x: 210, y: 330 },
    root: { x: 210, y: 500 },
    tld: { x: 210, y: 650 },
    auth: { x: 210, y: 800 },
  },
};

// The second machine connects for itself once it has an address. Its traffic
// does not go through the resolver either.
export const LEVEL3_EDGES: [string, string][] = [
  ...LEVEL2_EDGES,
  ["stub2", "recursor"],
  ["stub2", "origin"],
  ["stub2", "mail"],
];

export const LEVEL3_DEFERRED = new Set([
  ...LEVEL2_DEFERRED,
  "stub2:origin",
  "stub2:mail",
]);

// A second delegation directly under au., so a lookup can skip the root and
// still have to ask the TLD — a partial hit, not an all-or-nothing one.
const UNSW: Zone = {
  origin: "unsw.edu.au.",
  server: "auth",
  records: [
    { name: "unsw.edu.au.", type: "A", ttl: 3600, data: "18.67.93.67" },
    {
      name: "unsw.edu.au.",
      type: "SOA",
      ttl: 3600,
      data: "ddi-master.net.unsw.edu.au.",
    },
  ],
};

const UNSW_DELEGATION: DNSRecord[] = [
  { name: "unsw.edu.au.", type: "NS", ttl: 86400, data: "ns1-ext.unsw.edu.au." },
  { name: "ns1-ext.unsw.edu.au.", type: "A", ttl: 86400, data: "54.79.80.189" },
];

export const LEVEL3_ZONES: Zone[] = [
  ...LEVEL2_ZONES.map((zone) =>
    zone.origin === "au."
      ? { ...zone, records: [...zone.records, ...UNSW_DELEGATION] }
      : zone,
  ),
  UNSW,
];

// Ordered as a demonstration: resolve the first, ask it again for a full hit,
// then the second skips root and TLD, the third skips only the root, and the
// fourth is a cold walk again under a TLD nothing has touched.
export const LEVEL3_NAMES = [
  "anu.edu.au",
  "terra-web.anu.edu.au",
  "unsw.edu.au",
  "www.google.com",
];

export const LEVEL3: LevelConfig = {
  id: "l3",
  title: "Caching",
  nodes: LEVEL3_NODES,
  viewBox: { wide: "0 -60 960 620", narrow: "0 -60 420 960" },
  positions: LEVEL3_POSITIONS,
  edges: LEVEL3_EDGES,
  deferredEdges: LEVEL3_DEFERRED,
  types: ["A", "MX", "CNAME", "NS", "SOA"],
  destinations: { A: "origin", MX: "mail" },
  clients: ["stub", "stub2"],
  caching: true,
  simulated: true,
  attack: false,
  zones: LEVEL3_ZONES,
  knownNames: LEVEL3_NAMES,
  defaultQuery: "anu.edu.au",
};
