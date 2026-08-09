import type { Zone } from "../dns/types.js";
import type { LevelConfig, Positions } from "./types.js";

// "tld" and "auth" are roles, not machines: whichever zone the recursor is
// talking to takes that seat, so adding a TLD costs zone data and no layout.
export const NODE_LABELS: Record<string, { title: string; role: string }> = {
  stub: { title: "Your machine", role: "stub resolver" },
  recursor: { title: "Resolver", role: "recursive · caches" },
  root: { title: "Root", role: "authoritative for ." },
  tld: { title: "TLD", role: "waiting" },
  auth: { title: "Authoritative", role: "waiting" },
  origin: { title: "Web server", role: "the site itself" },
};

export const VIEWBOX = { wide: "0 0 960 460", narrow: "0 0 420 800" };

// The web server sits with the machine, not past the nameservers. Placing it
// beyond them draws a path that does not exist: your traffic never travels
// through a TLD server, it only asks one for directions.
export const POSITIONS: Positions = {
  wide: {
    stub: { x: 110, y: 150 },
    origin: { x: 110, y: 340 },
    recursor: { x: 380, y: 150 },
    root: { x: 720, y: 70 },
    tld: { x: 720, y: 230 },
    auth: { x: 720, y: 390 },
  },
  narrow: {
    stub: { x: 110, y: 60 },
    origin: { x: 305, y: 60 },
    recursor: { x: 210, y: 230 },
    root: { x: 210, y: 400 },
    tld: { x: 210, y: 550 },
    auth: { x: 210, y: 700 },
  },
};

// Edges the recursor may use. The stub only ever talks to the recursor.
export const EDGES: [string, string][] = [
  ["stub", "recursor"],
  ["recursor", "root"],
  ["recursor", "tld"],
  ["recursor", "auth"],
  ["stub", "origin"],
];

// You cannot draw a line to a server whose address you do not yet know. This
// edge stays hidden until the walk hands one back, which is the whole point
// of the walk.
export const DEFERRED_EDGES = new Set(["stub:origin"]);

// A miniature internet. Each zone knows only its own records and who it
// delegates to — no server here holds a complete picture, which is the point.
export const ZONES: Zone[] = [
  {
    origin: ".",
    server: "root",
    records: [
      { name: "au.", type: "NS", ttl: 172800, data: "ns1.au." },
      { name: "ns1.au.", type: "A", ttl: 172800, data: "203.119.40.1" },
      { name: "com.", type: "NS", ttl: 172800, data: "a.gtld-servers.net." },
      {
        name: "a.gtld-servers.net.",
        type: "A",
        ttl: 172800,
        data: "192.5.6.30",
      },
      { name: ".", type: "SOA", ttl: 86400, data: "a.root-servers.net." },
    ],
  },
  {
    origin: "au.",
    server: "tld",
    records: [
      { name: "anu.edu.au.", type: "NS", ttl: 86400, data: "ns1.anu.edu.au." },
      { name: "ns1.anu.edu.au.", type: "A", ttl: 86400, data: "130.56.111.10" },
      { name: "au.", type: "SOA", ttl: 86400, data: "ns1.au." },
    ],
  },
  {
    origin: "com.",
    server: "tld",
    records: [
      { name: "google.com.", type: "NS", ttl: 86400, data: "ns1.google.com." },
      { name: "ns1.google.com.", type: "A", ttl: 86400, data: "216.239.32.10" },
      { name: "com.", type: "SOA", ttl: 86400, data: "a.gtld-servers.net." },
    ],
  },
  {
    origin: "anu.edu.au.",
    server: "auth",
    records: [
      { name: "www.anu.edu.au.", type: "A", ttl: 3600, data: "149.171.96.10" },
      { name: "anu.edu.au.", type: "A", ttl: 3600, data: "149.171.96.10" },
      { name: "anu.edu.au.", type: "SOA", ttl: 3600, data: "ns1.anu.edu.au." },
    ],
  },
  {
    origin: "google.com.",
    server: "auth",
    records: [
      { name: "www.google.com.", type: "A", ttl: 300, data: "142.250.70.196" },
      { name: "google.com.", type: "A", ttl: 300, data: "142.250.70.196" },
      { name: "google.com.", type: "SOA", ttl: 900, data: "ns1.google.com." },
    ],
  },
];

// Offered in the input's datalist, so nobody has to guess what exists here.
export const KNOWN_NAMES = [
  "www.anu.edu.au",
  "anu.edu.au",
  "www.google.com",
  "google.com",
];

export const DEFAULT_QUERY = "www.anu.edu.au";

// L1 asks one question only — "where is this?" — so it offers no type picker.
export const LEVEL1: LevelConfig = {
  id: "l1",
  title: "The walk",
  nodes: NODE_LABELS,
  viewBox: VIEWBOX,
  positions: POSITIONS,
  edges: EDGES,
  deferredEdges: DEFERRED_EDGES,
  types: ["A"],
  zones: ZONES,
  knownNames: KNOWN_NAMES,
  defaultQuery: DEFAULT_QUERY,
};
