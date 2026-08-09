import {
  EDGES,
  NODE_LABELS,
  POSITIONS,
  VIEWBOX,
  type Positions,
} from "../levels/level1.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const NARROW = "(max-width: 700px)";

export type Layout = keyof Positions;

export interface Graph {
  root: SVGSVGElement;
  layout: Layout;
  nodeAt(id: string): { x: number; y: number };
  setNodeState(id: string, state: string): void;
  setNodeZone(id: string, zone: string): void;
  clearStates(): void;
  onLayoutChange(handler: () => void): void;
}

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  return node;
}

export function createGraph(container: HTMLElement): Graph {
  const media = window.matchMedia(NARROW);
  let layout: Layout = media.matches ? "narrow" : "wide";

  const svg = el("svg", {
    viewBox: VIEWBOX[layout],
    role: "img",
    "aria-label": "DNS resolution between your machine and the nameservers",
  });

  const edgeLayer = el("g", { class: "edges" });
  const nodeLayer = el("g", { class: "nodes" });
  svg.append(edgeLayer, nodeLayer);
  container.append(svg);

  const edgeLines = new Map<string, SVGLineElement>();
  const nodeGroups = new Map<string, SVGGElement>();
  const nodeRoles = new Map<string, SVGTextElement>();

  for (const [from, to] of EDGES) {
    const line = el("line", { class: "edge", "data-edge": `${from}:${to}` });
    edgeLines.set(`${from}:${to}`, line);
    edgeLayer.append(line);
  }

  for (const id of Object.keys(NODE_LABELS)) {
    const label = NODE_LABELS[id];
    if (label === undefined) continue;

    // Geometry stays in attributes, not CSS: the CSS geometry properties
    // (x/y/width/height) are not portable enough to bet the page on.
    const group = el("g", { class: "node", "data-node": id });
    const box = el("rect", {
      class: "node-box",
      x: "-74",
      y: "-30",
      width: "148",
      height: "60",
      rx: "10",
    });
    const title = el("text", { class: "node-title", x: "0", y: "-4" });
    title.textContent = label.title;
    const role = el("text", { class: "node-role", x: "0", y: "14" });
    role.textContent = label.role;

    group.append(box, title, role);
    nodeGroups.set(id, group);
    nodeRoles.set(id, role);
    nodeLayer.append(group);
  }

  const positionsFor = (id: string) =>
    POSITIONS[layout][id] ?? { x: 0, y: 0 };

  function place(): void {
    svg.setAttribute("viewBox", VIEWBOX[layout]);

    for (const [id, group] of nodeGroups) {
      const { x, y } = positionsFor(id);
      group.setAttribute("transform", `translate(${x} ${y})`);
    }

    for (const [key, line] of edgeLines) {
      const [from, to] = key.split(":");
      if (from === undefined || to === undefined) continue;
      const a = positionsFor(from);
      const b = positionsFor(to);
      line.setAttribute("x1", String(a.x));
      line.setAttribute("y1", String(a.y));
      line.setAttribute("x2", String(b.x));
      line.setAttribute("y2", String(b.y));
    }
  }

  place();

  const handlers: (() => void)[] = [];
  media.addEventListener("change", (event) => {
    layout = event.matches ? "narrow" : "wide";
    place();
    for (const handler of handlers) handler();
  });

  return {
    root: svg,
    get layout() {
      return layout;
    },
    nodeAt: positionsFor,
    setNodeState(id, state) {
      nodeGroups.get(id)?.setAttribute("data-state", state);
    },
    setNodeZone(id, zone) {
      const role = nodeRoles.get(id);
      if (role) role.textContent = `serving ${zone}`;
    },
    clearStates() {
      for (const group of nodeGroups.values()) {
        group.removeAttribute("data-state");
      }
      for (const [id, role] of nodeRoles) {
        role.textContent = NODE_LABELS[id]?.role ?? "";
      }
    },
    onLayoutChange(handler) {
      handlers.push(handler);
    },
  };
}
