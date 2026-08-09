import type { DNSRecord, Question, Response } from "./types.js";

// Forging a DNS reply, and the two things that decide whether it works: can
// you see the question, and can you guess the number attached to it. Pure and
// DOM-free like the rest of src/dns, with every random draw injected so a
// test can force a win or a loss.

export const ATTACKER = "attacker";

// A real transaction ID is 16 bits — 65,536 values. Nobody is going to click
// that many times, so the demo shrinks the space and says so on screen. Every
// attempt count shown to the visitor is honest for these odds and scales by
// SCALE for the real ones; nothing here pretends 4 bits is what DNS uses.
export const DEMO_BITS = 4;
export const REAL_BITS = 16;
export const SCALE = 2 ** (REAL_BITS - DEMO_BITS);

// Where the attacker is standing, which is the only thing that separates the
// two attacks. On-path can read the query; off-path has to guess at it.
export type Threat = "off" | "onpath" | "offpath";

export interface Defences {
  // Source-port randomisation. The reply must match a port as well as an ID,
  // so the search space is squared rather than doubled.
  ports: boolean;
  // Signed records. The forgery still arrives and can still quote the right
  // ID; it is thrown out for a reason that has nothing to do with the race.
  dnssec: boolean;
}

export const NO_DEFENCES: Defences = { ports: false, dnssec: false };

export const space = (defences: Defences): number =>
  defences.ports ? 2 ** (DEMO_BITS * 2) : 2 ** DEMO_BITS;

export const realSpace = (defences: Defences): number =>
  defences.ports ? 2 ** (REAL_BITS * 2) : 2 ** REAL_BITS;

// One forged reply, and everything needed to explain why it did or did not
// work. `response` is an ordinary Response, so a believed forgery goes
// through the resolver's existing code path untouched — which is the lesson.
export interface Forgery {
  response: Response;
  quoted: number;
  accepted: boolean;
  note: string;
}

export interface AttackerConfig {
  threat: Threat;
  defences: Defences;
  // The zone to steal and the nameserver name to steal it with.
  zone: string;
  ns: string;
  address: string;
  // Injected: a draw from [0, space) each time the attacker fires.
  guess: () => number;
}

// Not the address — the delegation. Forging "www is at my IP" wins one name
// until its TTL runs out. Forging "the nameserver for this zone is me" wins
// every name in the zone, and the resolver caches it exactly as it caches a
// real referral, because nothing in a cache records where a record came from.
export function poison(config: AttackerConfig): DNSRecord[] {
  return [
    { name: config.zone, type: "NS", ttl: 86400, data: config.ns },
    { name: config.ns, type: "A", ttl: 86400, data: config.address },
  ];
}

const hex = (value: number): string =>
  `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;

// The race, decided. An on-path attacker read the ID off the wire and cannot
// lose it; an off-path attacker is guessing, and the odds are the whole point.
export function forge(
  config: AttackerConfig,
  q: Question,
  txid: number,
): Forgery {
  const response: Response = { kind: "referral", records: poison(config) };
  const onPath = config.threat === "onpath";
  const quoted = onPath ? txid : config.guess();
  const matched = quoted === txid;

  // Validation happens after the reply is accepted as a reply, so a signed
  // zone does not make the attacker miss — it makes missing not matter.
  if (matched && config.defences.dnssec) {
    return {
      response,
      quoted,
      accepted: false,
      note: `ID ${hex(quoted)} matched, but the records carry no valid signature`,
    };
  }

  if (!matched) {
    return {
      response,
      quoted,
      accepted: false,
      note: `Quoted ${hex(quoted)}, the resolver was waiting for ${hex(txid)}`,
    };
  }

  const how = onPath
    ? "Read the ID straight off the wire"
    : `Guessed ${hex(quoted)} and hit it`;
  return {
    response,
    quoted,
    accepted: true,
    note: `${how} — ${q.name} now resolves through me`,
  };
}
