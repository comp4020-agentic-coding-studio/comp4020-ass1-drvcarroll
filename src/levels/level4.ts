import { ATTACKER } from "../dns/attack.js";
import type { Zone } from "../dns/types.js";
import type { LevelConfig } from "./types.js";
import {
  LEVEL3_DEFERRED,
  LEVEL3_EDGES,
  LEVEL3_NODES,
  LEVEL3_ZONES,
} from "./level3.js";

// Level 4 adds one node and takes nothing away. Every party the earlier
// levels introduced was a party you were trusting; this is the level where
// that is said out loud, by letting the visitor be the party.

export const ATTACKER_NS = "ns.attacker.example.";
export const ATTACKER_IP = "203.0.113.66";
export const STOLEN_ZONE = "anu.edu.au.";

export const LEVEL4_NODES = {
  ...LEVEL3_NODES,
  [ATTACKER]: { title: "Attacker", role: "answers first, or guesses" },
};

// The attacker sits between the resolver and the servers it is racing, which
// is where an on-path attacker literally is. Off-path it is the same seat,
// because the picture that changes is the packet, not the position.
export const LEVEL4_POSITIONS = {
  wide: {
    stub: { x: 110, y: 90 },
    stub2: { x: 110, y: 270 },
    recursor: { x: 360, y: 180 },
    [ATTACKER]: { x: 560, y: 470 },
    root: { x: 760, y: 70 },
    tld: { x: 760, y: 230 },
    auth: { x: 760, y: 390 },
    origin: { x: 80, y: 450 },
    mail: { x: 250, y: 450 },
  },
  narrow: {
    stub: { x: 110, y: 60 },
    stub2: { x: 305, y: 60 },
    origin: { x: 110, y: 150 },
    mail: { x: 305, y: 150 },
    recursor: { x: 210, y: 330 },
    [ATTACKER]: { x: 330, y: 480 },
    root: { x: 120, y: 620 },
    tld: { x: 120, y: 760 },
    auth: { x: 120, y: 900 },
  },
};

// The attacker only ever talks to the resolver: it is answering a question it
// was never asked, which is the whole of both attacks.
export const LEVEL4_EDGES: [string, string][] = [
  ...LEVEL3_EDGES,
  [ATTACKER, "recursor"],
];

// Drawn only once a forged packet actually travels it. Until then there is no
// honest line to draw — the attacker is not part of the resolution path.
export const LEVEL4_DEFERRED = new Set([
  ...LEVEL3_DEFERRED,
  `${ATTACKER}:recursor`,
]);

// The evil twin: same zone name, different nameserver, different addresses.
// Nothing distinguishes it from the real one except which server the resolver
// was told to ask — and that is exactly what the forged referral changes.
export const EVIL_ANU: Zone = {
  origin: STOLEN_ZONE,
  server: ATTACKER,
  ns: ATTACKER_NS,
  records: [
    { name: "anu.edu.au.", type: "A", ttl: 86400, data: ATTACKER_IP },
    { name: "www.anu.edu.au.", type: "A", ttl: 86400, data: ATTACKER_IP },
    { name: "terra-web.anu.edu.au.", type: "A", ttl: 86400, data: ATTACKER_IP },
    {
      name: "anu.edu.au.",
      type: "MX",
      ttl: 86400,
      data: `10 ${ATTACKER_NS}`,
    },
    { name: "anu.edu.au.", type: "SOA", ttl: 86400, data: ATTACKER_NS },
  ],
};

// Both zones are present from the start, and both are legitimate as far as
// the resolver is concerned. Which one it reaches is decided entirely by what
// its cache believes, which is the argument the level is making.
export const LEVEL4_ZONES: Zone[] = [
  ...LEVEL3_ZONES.map((zone) =>
    zone.origin === STOLEN_ZONE ? { ...zone, ns: "ns1.anu.edu.au." } : zone,
  ),
  EVIL_ANU,
];

// A name nobody has ever looked up and nobody ever will. Counted rather than
// drawn, so it is never accidentally one already in the cache: a guaranteed
// miss is a guaranteed retry, which is why Kaminsky's attack has no limit.
export const kaminskyName = (attempt: number): string =>
  `x${String(attempt)}.anu.edu.au`;

export const LEVEL4_NAMES = ["anu.edu.au", "www.anu.edu.au", "unsw.edu.au"];

export const LEVEL4: LevelConfig = {
  id: "l4",
  title: "Trust",
  nodes: LEVEL4_NODES,
  viewBox: { wide: "0 -60 960 620", narrow: "0 -60 420 1040" },
  positions: LEVEL4_POSITIONS,
  edges: LEVEL4_EDGES,
  deferredEdges: LEVEL4_DEFERRED,
  types: ["A", "MX", "CNAME", "NS", "SOA"],
  destinations: { A: "origin", MX: "mail" },
  clients: ["stub", "stub2"],
  caching: true,
  simulated: true,
  attack: true,
  zones: LEVEL4_ZONES,
  knownNames: LEVEL4_NAMES,
  defaultQuery: "anu.edu.au",
};
