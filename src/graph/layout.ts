import type { NodeId } from "../dns/types.js";
import type { Topology } from "../sim/topology.js";
import type { NodeLabel } from "../sim/types.js";

// Where the tiers land. Nothing here is a drawing: the visitor sets the counts
// and the funnel is whatever the arithmetic makes of them, at either viewport.

export interface Point {
  x: number;
  y: number;
}

// Both viewports are marked in full, so neither is a fallback for the other.
export interface Positions {
  wide: Record<string, Point>;
  narrow: Record<string, Point>;
}

export type LayoutName = keyof Positions;

// A machine you can read is a box; one of a crowd is a dot. Past a few dozen
// users a label each is the "spent twice" failure, so dots carry none.
export type Shape = "box" | "dot";

export interface Scene {
  nodes: Record<NodeId, NodeLabel>;
  shapes: Record<NodeId, Shape>;
  // Box width narrows as a tier fills. Dots use it as a diameter.
  widths: Record<NodeId, number>;
  edges: [NodeId, NodeId][];
  positions: Record<NodeId, Point>;
  viewBox: string;
}

interface Metrics {
  width: number;
  margin: number;
  // A box row is the box plus the gap under it.
  boxRow: number;
  dotRow: number;
  dotPitch: number;
  dotSize: number;
  tierGap: number;
  top: number;
  bottom: number;
}

const BOX_HEIGHT = 60;
const MAX_BOX = 148;
const MIN_BOX = 64;
// Below this the boxes in a row would overlap, so the tier wraps instead.
const MIN_PITCH = MIN_BOX + 12;

const METRICS: Record<LayoutName, Metrics> = {
  wide: {
    width: 1000,
    margin: 16,
    boxRow: 78,
    dotRow: 22,
    dotPitch: 22,
    dotSize: 14,
    tierGap: 50,
    top: 40,
    bottom: 40,
  },
  narrow: {
    width: 420,
    margin: 16,
    boxRow: 74,
    dotRow: 18,
    dotPitch: 14,
    dotSize: 10,
    tierGap: 38,
    top: 32,
    bottom: 32,
  },
};

const clamp = (low: number, value: number, high: number): number =>
  Math.min(high, Math.max(low, value));

// Split n into rows of at most perRow, as evenly as they divide. Even rows
// keep the picture balanced as a tier grows rather than leaving a stub.
function rowSizes(n: number, perRow: number): number[] {
  const rows = Math.max(1, Math.ceil(n / perRow));
  const sizes: number[] = [];
  let left = n;
  for (let r = 0; r < rows; r += 1) {
    const take = Math.ceil(left / (rows - r));
    sizes.push(take);
    left -= take;
  }
  return sizes;
}

// One tier of boxes. Columns line up across rows because the pitch is the
// row's share of the usable width, not the count in that particular row.
function placeBoxes(
  ids: NodeId[],
  top: number,
  m: Metrics,
  scene: Scene,
): number {
  const usable = m.width - m.margin * 2;
  const perRow = Math.min(ids.length, Math.max(1, Math.floor(usable / MIN_PITCH)));
  const pitch = usable / perRow;
  const width = clamp(MIN_BOX, pitch - 12, MAX_BOX);

  let index = 0;
  const sizes = rowSizes(ids.length, perRow);
  for (const [row, count] of sizes.entries()) {
    const y = top + BOX_HEIGHT / 2 + row * m.boxRow;
    for (let i = 0; i < count; i += 1) {
      const id = ids[index] ?? "";
      index += 1;
      scene.positions[id] = { x: m.width / 2 + (i - (count - 1) / 2) * pitch, y };
      scene.shapes[id] = "box";
      scene.widths[id] = width;
    }
  }
  return sizes.length * m.boxRow;
}

// The user tier is a lattice on a fixed pitch: the crowd should read as a
// crowd, and dots that shrink with the count would hide the growth instead.
function placeDots(
  ids: NodeId[],
  top: number,
  m: Metrics,
  scene: Scene,
): number {
  const usable = m.width - m.margin * 2;
  const perRow = Math.min(ids.length, Math.max(1, Math.floor(usable / m.dotPitch)));

  let index = 0;
  const sizes = rowSizes(ids.length, perRow);
  for (const [row, count] of sizes.entries()) {
    const y = top + m.dotSize / 2 + row * m.dotRow;
    for (let i = 0; i < count; i += 1) {
      const id = ids[index] ?? "";
      index += 1;
      scene.positions[id] = {
        x: m.width / 2 + (i - (count - 1) / 2) * m.dotPitch,
        y,
      };
      scene.shapes[id] = "dot";
      scene.widths[id] = m.dotSize;
    }
  }
  return sizes.length * m.dotRow;
}

export function layout(topology: Topology, name: LayoutName): Scene {
  const m = METRICS[name];
  const scene: Scene = {
    nodes: topology.nodes,
    shapes: {},
    widths: {},
    edges: topology.edges,
    positions: {},
    viewBox: "",
  };

  // Tiers stack by the rows they actually took, so a wrapped tier pushes the
  // ones below it down instead of drawing through them.
  let cursor = m.top;
  for (const [tier, ids] of topology.tiers.entries()) {
    const isUsers = tier === topology.tiers.length - 1;
    const used = isUsers
      ? placeDots(ids, cursor, m, scene)
      : placeBoxes(ids, cursor, m, scene);
    cursor += used + m.tierGap;
  }

  const height = cursor - m.tierGap + m.bottom;
  scene.viewBox = `0 0 ${String(m.width)} ${String(Math.round(height))}`;
  return scene;
}
