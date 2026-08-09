import type { NodeId, RecordType, Zone } from "../dns/types.js";

export interface Point {
  x: number;
  y: number;
}

// Two coordinate sets per level: a horizontal chain reads well at 1920x1080,
// a vertical one at 390x844. Both are marked in full, so neither is a
// fallback for the other.
export interface Positions {
  wide: Record<string, Point>;
  narrow: Record<string, Point>;
}

export interface NodeLabel {
  title: string;
  role: string;
}

// Everything a level changes about the one persistent graph. Levels
// reconfigure it; they never replace it, so the visitor can see what a level
// added rather than being handed a fresh diagram.
export interface LevelConfig {
  id: string;
  title: string;
  nodes: Record<string, NodeLabel>;
  viewBox: { wide: string; narrow: string };
  positions: Positions;
  edges: [string, string][];
  // Edges that cannot honestly be drawn until a step uses them.
  deferredEdges: Set<string>;
  // Offered in the record-type picker. One entry means no picker.
  types: RecordType[];
  // What a resolved record actually lets you reach. A type absent here ends
  // the walk with nothing to connect to, which is true of NS and SOA.
  destinations: Partial<Record<RecordType, string>>;
  // Who may ask. More than one machine means the resolver is shared
  // infrastructure, and so is everything it remembers.
  clients: NodeId[];
  // The resolver keeps what it learns between lookups.
  caching: boolean;
  // Cache state and TTL expiry cannot be observed from a browser, so a level
  // that teaches them uses the stored world and says so rather than pretending.
  simulated: boolean;
  // Somebody is allowed to answer a question they were not asked. Simulated
  // necessarily: a page that really did this would be committing the attack.
  attack: boolean;
  zones: Zone[];
  knownNames: string[];
  defaultQuery: string;
}
