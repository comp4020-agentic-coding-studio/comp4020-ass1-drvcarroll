import type { Zone } from "../dns/types.js";

// Two coordinate sets per level: a horizontal chain reads well at 1920x1080,
// a vertical one at 390x844. Both are marked in full, so neither is a
// fallback for the other.
export interface Positions {
  wide: Record<string, { x: number; y: number }>;
  narrow: Record<string, { x: number; y: number }>;
}

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

export const VIEWBOX = { wide: "0 0 960 420", narrow: "0 0 420 900" };

export const POSITIONS: Positions = {
  wide: {
    stub: { x: 90, y: 210 },
    recursor: { x: 300, y: 210 },
    root: { x: 620, y: 70 },
    tld: { x: 620, y: 210 },
    auth: { x: 620, y: 350 },
    origin: { x: 870, y: 210 },
  },
  narrow: {
    stub: { x: 210, y: 70 },
    recursor: { x: 210, y: 230 },
    root: { x: 210, y: 400 },
    tld: { x: 210, y: 550 },
    auth: { x: 210, y: 700 },
    origin: { x: 210, y: 840 },
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
