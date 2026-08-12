import type { LevelConfig, Point, Positions } from "../levels/types.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const NARROW = "(max-width: 700px)";
const LABEL_OFFSET = 15;

// A speech box grows upward from the node that spoke, so the slot is anchored
// by its bottom edge. Node positions are centres and a node is 60 tall.
const SPEECH = { width: 210, height: 78, gap: 8, nodeHalf: 30 };

// Compass arrows, indexed by eighth-turn. SVG y grows downward.
const ARROWS = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];

function arrowFor(from: Point, to: Point): string {
  const eighth = Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 4);
  return ARROWS[(Math.round(eighth) + 8) % 8] ?? "→";
}

export type Layout = keyof Positions;

export interface Graph {
  root: SVGSVGElement;
  layout: Layout;
  nodeAt(id: string): Point;
  setLevel(level: LevelConfig): void;
  setNodeState(id: string, state: string): void;
  setNodeZone(id: string, zone: string): void;
  say(id: string, text: string, kind: string): void;
  revealEdge(from: string, to: string): void;
  markEdge(from: string, to: string, label: string): void;
  clearStates(): void;
  onLayoutChange(handler: () => void): void;
  // A machine is a thing you can open, not just a thing that lights up.
  onNodeSelect(handler: (id: string | undefined) => void): void;
  openInspector(id: string, title: string, body: HTMLElement): void;
  closeInspector(): void;
  inspecting(): string | undefined;
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

export function createGraph(
  container: HTMLElement,
  initial: LevelConfig,
): Graph {
  const media = window.matchMedia(NARROW);
  let layout: Layout = media.matches ? "narrow" : "wide";
  let level = initial;

  const svg = el("svg", {
    viewBox: level.viewBox[layout],
    role: "img",
    "aria-label": "DNS resolution between your machine and the nameservers",
  });

  const edgeLayer = el("g", { class: "edges" });
  const labelLayer = el("g", { class: "edge-labels" });
  const nodeLayer = el("g", { class: "nodes" });
  const speechLayer = el("g", { class: "speech-layer" });
  svg.append(edgeLayer, labelLayer, nodeLayer, speechLayer);
  container.append(svg);

  const edgeLines = new Map<string, SVGLineElement>();
  const edgeLabels = new Map<string, SVGTextElement>();
  // Traversals are stored, not their rendered text: the arrow depends on the
  // layout, and the layout can change under us.
  const edgeMarks = new Map<string, { from: string; to: string; at: string }[]>();
  const nodeGroups = new Map<string, SVGGElement>();
  const nodeRoles = new Map<string, SVGTextElement>();
  const speech = new Map<string, SVGForeignObjectElement>();

  // Edges are undirected on screen, so a step going either way finds one.
  const edgeKey = (from: string, to: string): string | undefined => {
    if (edgeLines.has(`${from}:${to}`)) return `${from}:${to}`;
    if (edgeLines.has(`${to}:${from}`)) return `${to}:${from}`;
    return undefined;
  };

  const positionsFor = (id: string): Point =>
    level.positions[layout][id] ?? { x: 0, y: 0 };

  // The inspector is HTML over the SVG rather than a foreignObject: it holds
  // scrolling tables, and foreignObject scrolling is not dependable enough to
  // put the phone viewport on. Anchored to its node when there is room, a
  // sheet across the bottom of the stage when there is not — CSS decides.
  const inspector = document.createElement("div");
  inspector.className = "inspector";
  inspector.tabIndex = -1;
  inspector.hidden = true;
  container.append(inspector);

  const selectHandlers: ((id: string | undefined) => void)[] = [];
  let opened: string | undefined;

  // SVG user units to pixels within the stage. Default preserveAspectRatio
  // letterboxes, so the offset is not optional.
  function anchor(): void {
    if (opened === undefined) return;
    const [vx = 0, vy = 0, vw = 1, vh = 1] = level.viewBox[layout]
      .split(/\s+/)
      .map(Number);
    const rect = svg.getBoundingClientRect();
    const base = container.getBoundingClientRect();
    const scale = Math.min(rect.width / vw, rect.height / vh);
    const { x, y } = positionsFor(opened);
    // Offsets are measured against the container the panel is positioned in,
    // not the svg, because the stage has padding between the two.
    const left = rect.left - base.left + (rect.width - vw * scale) / 2;
    const top = rect.top - base.top + (rect.height - vh * scale) / 2;
    inspector.style.setProperty("--anchor-x", `${String(left + (x - vx) * scale)}px`);
    inspector.style.setProperty("--anchor-y", `${String(top + (y - vy) * scale)}px`);
  }

  function closeInspector(): void {
    if (opened === undefined) return;
    const was = opened;
    opened = undefined;
    inspector.hidden = true;
    inspector.replaceChildren();
    nodeGroups.get(was)?.removeAttribute("data-open");
    for (const handler of selectHandlers) handler(undefined);
  }

  function openInspector(id: string, title: string, body: HTMLElement): void {
    if (opened !== undefined && opened !== id) {
      nodeGroups.get(opened)?.removeAttribute("data-open");
    }
    opened = id;
    nodeGroups.get(id)?.setAttribute("data-open", "true");

    const head = document.createElement("header");
    const heading = document.createElement("h3");
    heading.textContent = title;
    const shut = document.createElement("button");
    shut.type = "button";
    shut.className = "inspector-close";
    shut.setAttribute("aria-label", "Close");
    shut.textContent = "×";
    shut.addEventListener("click", () => {
      closeInspector();
      nodeGroups.get(id)?.focus();
    });
    head.append(heading, shut);

    inspector.replaceChildren(head, body);
    inspector.hidden = false;
    anchor();
  }

  // Toggling, so the same click that opened a machine closes it.
  function select(id: string): void {
    if (opened === id) {
      closeInspector();
      return;
    }
    for (const handler of selectHandlers) handler(id);
  }

  inspector.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const was = opened;
    closeInspector();
    if (was !== undefined) nodeGroups.get(was)?.focus();
  });

  // Resize mid-interaction is one of the things this is marked on, so the
  // anchor is recomputed rather than assumed to survive.
  window.addEventListener("resize", anchor);

  function addEdge(key: string): void {
    const line = el("line", {
      class: "edge",
      "data-edge": key,
      "data-hidden": String(level.deferredEdges.has(key)),
    });
    edgeLines.set(key, line);
    edgeLayer.append(line);

    const label = el("text", { class: "edge-label" });
    edgeLabels.set(key, label);
    labelLayer.append(label);
  }

  function addNode(id: string, entering: boolean): void {
    const label = level.nodes[id];
    if (label === undefined) return;

    // Geometry stays in attributes, not CSS: the CSS geometry properties
    // (x/y/width/height) are not portable enough to bet the page on.
    // A real button, not a click handler on a shape: the marker tabs through
    // this page, and an SVG group has none of that for free.
    const group = el("g", {
      class: "node",
      "data-node": id,
      role: "button",
      tabindex: "0",
      "aria-label": `${label.title} — ${label.role}. Show its records.`,
    });
    group.addEventListener("click", () => {
      select(id);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault(); // Space would scroll the page out from under it
      select(id);
    });
    if (entering) group.setAttribute("data-entering", "true");
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

    // Placed first, revealed on the next frame, so the fade actually runs.
    if (entering) {
      requestAnimationFrame(() => {
        group.removeAttribute("data-entering");
      });
    }
  }

  function placeSpeech(id: string, slot: SVGForeignObjectElement): void {
    const { x, y } = positionsFor(id);
    slot.setAttribute("x", String(x - SPEECH.width / 2));
    slot.setAttribute(
      "y",
      String(y - SPEECH.nodeHalf - SPEECH.gap - SPEECH.height),
    );
  }

  function clearSpeech(): void {
    for (const slot of speech.values()) slot.remove();
    speech.clear();
  }

  function place(): void {
    svg.setAttribute("viewBox", level.viewBox[layout]);

    for (const [id, group] of nodeGroups) {
      const { x, y } = positionsFor(id);
      group.setAttribute("transform", `translate(${x} ${y})`);
    }

    for (const [id, slot] of speech) placeSpeech(id, slot);

    for (const [key, line] of edgeLines) {
      const [from, to] = key.split(":");
      if (from === undefined || to === undefined) continue;
      const a = positionsFor(from);
      const b = positionsFor(to);
      line.setAttribute("x1", String(a.x));
      line.setAttribute("y1", String(a.y));
      line.setAttribute("x2", String(b.x));
      line.setAttribute("y2", String(b.y));

      // Labels sit off to one side of the line, so they never overprint it.
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const label = edgeLabels.get(key);
      if (label === undefined) continue;
      label.setAttribute(
        "x",
        String((a.x + b.x) / 2 - ((b.y - a.y) / length) * LABEL_OFFSET),
      );
      label.setAttribute(
        "y",
        String((a.y + b.y) / 2 + ((b.x - a.x) / length) * LABEL_OFFSET),
      );
      label.textContent = (edgeMarks.get(key) ?? [])
        .map((m) => `${m.at}${arrowFor(positionsFor(m.from), positionsFor(m.to))}`)
        .join(" ");
    }

    anchor();
  }

  function resetEdges(): void {
    edgeMarks.clear();
    for (const label of edgeLabels.values()) label.textContent = "";
    for (const [key, line] of edgeLines) {
      line.setAttribute("data-hidden", String(level.deferredEdges.has(key)));
    }
  }

  // A level is a diff, not a redraw: what a level adds should be visibly
  // added, because that is the escalation the visitor is being shown.
  function syncTo(next: LevelConfig): void {
    const first = nodeGroups.size === 0;
    level = next;

    // A machine's records belong to the level that defined them, so an open
    // panel cannot survive into a level that may not contain that machine.
    closeInspector();

    const wanted = new Set(next.edges.map(([from, to]) => `${from}:${to}`));
    for (const [key, line] of edgeLines) {
      if (wanted.has(key)) continue;
      line.remove();
      edgeLabels.get(key)?.remove();
      edgeLines.delete(key);
      edgeLabels.delete(key);
    }
    for (const key of wanted) if (!edgeLines.has(key)) addEdge(key);

    for (const [id, group] of nodeGroups) {
      if (id in next.nodes) continue;
      group.remove();
      nodeGroups.delete(id);
      nodeRoles.delete(id);
    }
    for (const id of Object.keys(next.nodes)) {
      if (!nodeGroups.has(id)) addNode(id, !first);
    }

    clearSpeech();
    resetEdges();
    place();
  }

  syncTo(initial);

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
    setLevel: syncTo,
    setNodeState(id, state) {
      nodeGroups.get(id)?.setAttribute("data-state", state);
    },
    setNodeZone(id, zone) {
      const role = nodeRoles.get(id);
      if (role) role.textContent = `serving ${zone}`;
    },
    // The box belongs to whoever spoke, question or answer alike, and it
    // stays put — at the end the graph is holding the whole conversation.
    say(id, text, kind) {
      let slot = speech.get(id);
      if (slot === undefined) {
        slot = el("foreignObject", {
          class: "speech",
          width: String(SPEECH.width),
          height: String(SPEECH.height),
        });
        const inner = document.createElement("div");
        inner.className = "speech-slot";
        const box = document.createElement("div");
        box.className = "speech-box";
        inner.append(box);
        slot.append(inner);
        speech.set(id, slot);
        speechLayer.append(slot);
        placeSpeech(id, slot);
      }
      const box = slot.querySelector(".speech-box");
      if (box === null) return;
      box.setAttribute("data-kind", kind);
      box.textContent = text;
    },
    revealEdge(from, to) {
      const key = edgeKey(from, to);
      if (key) edgeLines.get(key)?.setAttribute("data-hidden", "false");
    },
    markEdge(from, to, label) {
      const key = edgeKey(from, to);
      if (key === undefined) return;
      edgeMarks.set(key, [
        ...(edgeMarks.get(key) ?? []),
        { from, to, at: label },
      ]);
      place();
    },
    clearStates() {
      for (const group of nodeGroups.values()) {
        group.removeAttribute("data-state");
      }
      for (const [id, role] of nodeRoles) {
        role.textContent = level.nodes[id]?.role ?? "";
      }
      clearSpeech();
      resetEdges();
    },
    onLayoutChange(handler) {
      handlers.push(handler);
    },
    onNodeSelect(handler) {
      selectHandlers.push(handler);
    },
    openInspector,
    closeInspector,
    inspecting: () => opened,
  };
}
