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

// Negative top: the speech boxes grow upward out of the topmost nodes, so
// the canvas has to start above them.
export const VIEWBOX = { wide: "0 -60 960 520", narrow: "0 -60 420 860" };

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
// Every record below was checked against the real DNS: this world is a
// smaller internet, not an invented one, so nothing here teaches a name or an
// address that would fall over the moment somebody looked it up.
export const ZONES: Zone[] = [
  {
    origin: ".",
    server: "root",
    records: [
      { name: "au.", type: "NS", ttl: 172800, data: "s.au." },
      { name: "s.au.", type: "A", ttl: 172800, data: "65.22.198.1" },
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
      { name: "ns1.anu.edu.au.", type: "A", ttl: 86400, data: "150.203.1.10" },
      { name: "au.", type: "SOA", ttl: 86400, data: "s.au." },
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
      // www really is an alias, and the resolver really does hide the hop
      // when you only ask for an address.
      {
        name: "www.anu.edu.au.",
        type: "CNAME",
        ttl: 300,
        data: "terra-web.anu.edu.au.",
      },
      {
        name: "terra-web.anu.edu.au.",
        type: "A",
        ttl: 300,
        data: "130.56.67.33",
      },
      { name: "anu.edu.au.", type: "A", ttl: 3600, data: "130.56.67.33" },
      { name: "anu.edu.au.", type: "SOA", ttl: 3600, data: "anugm.anu.edu.au." },
    ],
  },
  {
    origin: "google.com.",
    server: "auth",
    records: [
      { name: "www.google.com.", type: "A", ttl: 300, data: "142.251.151.119" },
      { name: "google.com.", type: "A", ttl: 300, data: "142.250.183.46" },
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

// The apex, not www: www is genuinely an alias, and level 1 has not yet
// earned the restart that an alias forces. www stays offered, not assumed.
export const DEFAULT_QUERY = "anu.edu.au";

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
  destinations: { A: "origin" },
  clients: ["stub"],
  caching: false,
  simulated: false,
  attack: false,
  zones: ZONES,
  knownNames: KNOWN_NAMES,
  defaultQuery: DEFAULT_QUERY,
};
