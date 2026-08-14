import type { Zone } from "../src/dns/types.js";

// A hand-written miniature internet, kept for the protocol tests alone. The
// page runs on a generated topology now, but the resolver's behaviour is worth
// asserting against real names with real, uneven TTLs and two TLDs — which is
// exactly what a tier of uniform generated zones cannot provide.
//
// Lifted from the four level files this replaced, values unchanged, so nothing
// those tests proved is quietly proved about different data.

export const WORLD: Zone[] = [
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
      // A second delegation directly under au., so a lookup can skip the root
      // and still have to ask the TLD — a partial cache hit, not an
      // all-or-nothing one.
      {
        name: "unsw.edu.au.",
        type: "NS",
        ttl: 86400,
        data: "ns1-ext.unsw.edu.au.",
      },
      {
        name: "ns1-ext.unsw.edu.au.",
        type: "A",
        ttl: 86400,
        data: "54.79.80.189",
      },
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
      // www really is an alias, and the resolver really does hide the hop when
      // you only ask for an address.
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
      // A zone's apex NS set is the delegation, restated by the zone that owns
      // it — the tree's own wiring, asked for directly.
      { name: "anu.edu.au.", type: "NS", ttl: 86400, data: "ns1.anu.edu.au." },
      { name: "anu.edu.au.", type: "NS", ttl: 86400, data: "una.anu.edu.au." },
      { name: "una.anu.edu.au.", type: "A", ttl: 86400, data: "150.203.22.28" },
      {
        name: "anu.edu.au.",
        type: "MX",
        ttl: 3600,
        data: "10 anu-edu-au.mail.protection.outlook.com.",
      },
      { name: "anu.edu.au.", type: "SOA", ttl: 3600, data: "anugm.anu.edu.au." },
    ],
  },
  {
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
  },
  {
    origin: "google.com.",
    server: "auth",
    records: [
      { name: "www.google.com.", type: "A", ttl: 300, data: "142.251.151.119" },
      { name: "google.com.", type: "A", ttl: 300, data: "142.250.183.46" },
      { name: "google.com.", type: "MX", ttl: 300, data: "10 smtp.google.com." },
      { name: "smtp.google.com.", type: "A", ttl: 300, data: "74.125.68.26" },
      { name: "google.com.", type: "SOA", ttl: 900, data: "ns1.google.com." },
    ],
  },
];
