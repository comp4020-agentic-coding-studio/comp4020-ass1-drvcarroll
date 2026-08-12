import type { Defences, Threat } from "../dns/attack.js";
import type { NodeId, RecordType } from "../dns/types.js";

// What a node says about itself. It lives here rather than with the layout
// because a machine's title and role now fall out of where it sits in the
// hierarchy, and the hierarchy is the simulation's business.
export interface NodeLabel {
  title: string;
  role: string;
}

// The bounds are the honest limits of the picture, not of DNS. Past these the
// graph stops being readable and the browser stops keeping up, and the page
// says so rather than quietly clamping.
export const LIMITS = {
  users: { min: 1, max: 60 },
  resolvers: { min: 1, max: 6 },
  authorities: { min: 1, max: 8 },
  ratePerUser: { min: 0.2, max: 20 },
  ttl: { min: 1, max: 86400 },
} as const;

// Everything the visitor can change. One flat object, so a run is fully
// described by this plus a seed — which is what makes a claim reproducible.
export interface SimConfig {
  seed: number;
  users: number;
  resolvers: number;
  authorities: number;
  // Queries per second, per user.
  ratePerUser: number;
  // Seconds. Every record in this world carries it, delegations included,
  // which is what lets one knob move the load on the whole hierarchy.
  ttl: number;
  // Which record types get asked for, drawn uniformly. An empty mix would
  // mean a silent world, so the UI never allows it.
  mix: RecordType[];
  // Where the attacker is standing. "off" is nobody.
  attacker: Threat;
  // What the resolvers do about it.
  defences: Defences;
  // Queries per second a server answers before it starts queueing. Absent
  // means no ceiling worth modelling.
  capacity: Partial<Record<NodeId, number>>;
  // Servers that are down. An array rather than a Set so a config stays a
  // plain value that a test can compare and clone.
  offline: readonly NodeId[];
}
