// Draws a Scene, and diffs rather than redraws so that what the visitor caused
// is visibly what changed. Everything here is a consequence of the scene: no
// state lives in the DOM that is not also in the World.

import { ICON_GRID, ICONS } from "./icons.js";
import type { Box, LayoutName, Scene, SceneNode } from "./layout.js";
import { durationFor } from "./motion.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const NARROW = "(max-width: 700px)";
const ANNOTATION_MS = 2200;

export type Layout = LayoutName;

export interface Graph {
  root: SVGSVGElement;
  layout: Layout;
  boxOf(id: string): Box | undefined;
  // A function of the viewport rather than a finished scene: the graph knows
  // when the layout changed, so it should be the one to ask again.
  setScene(make: (layout: Layout) => Scene): void;
  // One object travelling, so a commit is seen to rise out of your files and a
  // push is seen to cross the gap.
  sendObject(from: string, to: string, kind: "inside" | "network"): void;
  // Feedback at the object it happened to. The page-level live region is the
  // accessible mirror of this, not the primary channel.
  annotate(id: string, text: string): void;
  // The suggestion, drawn beside the entity it names and marking that entity.
  // Passing no entity, or an entity not currently drawn, hides it.
  hint(text: string, at?: string): void;
  onLayoutChange(handler: () => void): void;
  onSelect(handler: (id: string) => void): void;
  // Pointer-only, and never on touch: a vertical drag competes with the page
  // scroll on a phone, and a gesture that is flaky where it is marked is worth
  // less than not having it. Click and keyboard already do all of this.
  onDrop(handler: (from: string, to: string) => void): void;
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

const centre = (box: Box): { x: number; y: number } => ({
  x: box.x + box.w / 2,
  y: box.y + box.h / 2,
});

// What a screen reader is told about a shape. The same sentence a sighted
// visitor gets from the drawing, said once.
function describe(node: SceneNode): string {
  if (node.kind === "frame") {
    const state = node.open === true ? "open" : `closed, ${node.badge ?? ""}`;
    return `${node.title}, ${state}`;
  }
  if (node.kind === "file") {
    const glyph = node.glyph ?? "";
    const said: Record<string, string> = {
      A: "new, not yet staged",
      M: "modified since you staged it",
      S: "staged",
      D: "deleted",
      "": "unchanged",
    };
    return `${node.title}, ${said[glyph] ?? glyph}`;
  }
  if (node.kind === "blob") return `staged content of ${node.title}`;
  if (node.kind === "commit") return `commit ${node.glyph ?? ""}, ${node.title}`;
  return `${node.title}, a name pointing at a commit`;
}

export function createGraph(
  container: HTMLElement,
  initial: (layout: Layout) => Scene,
): Graph {
  const media = window.matchMedia(NARROW);
  let layout: Layout = media.matches ? "narrow" : "wide";
  let make = initial;
  let scene = make(layout);

  const svg = el("svg", {
    viewBox: scene.viewBox,
    role: "img",
    "aria-label": "Your Local Device, holding Your Files, the index and .git, with a Git Server above it across a network gap",
  });

  // Frames are filled, so they go under the links; a parent line drawn beneath
  // a compartment's own background is a line nobody ever sees.
  const frameLayer = el("g", { class: "frames" });
  const linkLayer = el("g", { class: "links" });
  const nodeLayer = el("g", { class: "nodes" });
  const flightLayer = el("g", { class: "flights" });
  const noteLayer = el("g", { class: "notes" });
  svg.append(frameLayer, linkLayer, nodeLayer, flightLayer, noteLayer);
  container.append(svg);

  const groups = new Map<string, SVGGElement>();
  const lines = new Map<string, SVGLineElement>();
  const notes = new Map<string, SVGGElement>();
  const timers = new Map<string, number>();
  let byId = new Map(scene.nodes.map((n) => [n.id, n]));

  const boxOf = (id: string): Box | undefined => byId.get(id)?.box;

  // Above the object it happened to, pulled back inside the drawing if that
  // would put it off the edge. Feedback that scrolls away is not feedback.
  function notePlacement(box: Box, note?: SVGGElement): string {
    const [x0 = 0, , w = 1000] = scene.viewBox.split(/\s+/).map(Number);
    // Measured, because a sentence wider than the phone viewport clamped by a
    // guessed margin still runs off the edge, which is where they were running.
    // Guarded: jsdom draws nothing, so it measures nothing either.
    const text = note?.querySelector("text");
    const measured =
      typeof text?.getComputedTextLength === "function"
        ? text.getComputedTextLength()
        : 0;
    const half = measured / 2 + 8;
    const x =
      2 * half >= w
        ? x0 + w / 2
        : Math.min(Math.max(box.x + 4, x0 + half), x0 + w - half);
    return `translate(${String(x)} ${String(Math.max(box.y - 26, 14))})`;
  }

  // The inspector is HTML over the SVG rather than a foreignObject: it holds
  // editable text, and foreignObject is not dependable enough to put the phone
  // viewport on. CSS decides between anchored panel and bottom sheet.
  const inspector = document.createElement("div");
  inspector.className = "inspector";
  inspector.tabIndex = -1;
  inspector.hidden = true;
  container.append(inspector);

  // The suggestion, drawn beside the picture and level with the entity it
  // names. It is HTML for the same reason the inspector is: it wraps.
  const hintEl = document.createElement("p");
  hintEl.className = "hint";
  hintEl.hidden = true;
  container.append(hintEl);

  const selectHandlers: ((id: string) => void)[] = [];
  const dropHandlers: ((from: string, to: string) => void)[] = [];
  let opened: string | undefined;
  let hinted: string | undefined;

  // SVG user units to pixels within the stage. Default preserveAspectRatio
  // letterboxes, so the offset is not optional. One projection, used by both
  // things that have to sit beside an object: the inspector and the hint.
  interface Projection {
    px: (u: number) => number;
    py: (u: number) => number;
    room: number;
  }

  function project(): Projection {
    const [vx = 0, vy = 0, vw = 1, vh = 1] = scene.viewBox
      .split(/\s+/)
      .map(Number);
    const rect = svg.getBoundingClientRect();
    const base = container.getBoundingClientRect();
    const scale = Math.min(rect.width / vw, rect.height / vh);
    const left = rect.left - base.left + (rect.width - vw * scale) / 2;
    const top = rect.top - base.top + (rect.height - vh * scale) / 2;
    return {
      px: (u) => left + (u - vx) * scale,
      py: (u) => top + (u - vy) * scale,
      room: base.width,
    };
  }

  function anchor(): void {
    if (opened === undefined) return;
    const box = boxOf(opened);
    if (box === undefined) return;
    const { x, y } = centre(box);
    const { px, py, room } = project();

    // Beside the object, never on top of it: a panel that covers the thing it
    // describes breaks the one link the visitor is being asked to make. It
    // flips to whichever side has room, and only centres if neither does.
    const gap = 12;
    const width = inspector.offsetWidth;
    const right = px(box.x + box.w) + gap;
    const start = px(box.x) - gap;
    let side = "over";
    let anchorX = px(x);
    if (right + width <= room) {
      side = "right";
      anchorX = right;
    } else if (start - width >= 0) {
      side = "left";
      anchorX = start;
    }
    inspector.dataset["side"] = side;
    inspector.style.setProperty("--anchor-x", `${String(anchorX)}px`);
    inspector.style.setProperty("--anchor-y", `${String(py(y))}px`);
  }

  // Level with the row it refers to. Recomputed on every redraw and every
  // resize, because a hint pointing at where an entity used to be is worse
  // than no hint at all.
  function placeHint(): void {
    if (hinted === undefined) return;
    const box = boxOf(hinted);
    if (box === undefined) return;
    hintEl.style.setProperty("--hint-y", `${String(project().py(centre(box).y))}px`);
  }

  function closeInspector(): void {
    if (opened === undefined) return;
    const was = opened;
    opened = undefined;
    inspector.hidden = true;
    inspector.replaceChildren();
    groups.get(was)?.removeAttribute("data-open");
  }

  function openInspector(id: string, title: string, body: HTMLElement): void {
    if (opened !== undefined && opened !== id) {
      groups.get(opened)?.removeAttribute("data-open");
    }
    opened = id;
    groups.get(id)?.setAttribute("data-open", "true");

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
      groups.get(id)?.focus();
    });
    head.append(heading, shut);

    inspector.replaceChildren(head, body);
    inspector.hidden = false;
    anchor();
  }

  inspector.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const was = opened;
    closeInspector();
    if (was !== undefined) groups.get(was)?.focus();
  });

  // Resize mid-interaction is one of the things this is marked on, so the
  // anchor is recomputed rather than assumed to survive.
  window.addEventListener("resize", () => {
    anchor();
    placeHint();
  });

  function shapeFor(node: SceneNode): SVGElement[] {
    const { box } = node;
    if (node.kind === "commit") {
      const c = centre(box);
      return [
        el("circle", {
          class: "shape commit",
          cx: String(c.x),
          cy: String(c.y),
          r: String(box.w / 2),
        }),
      ];
    }
    const rounding: Record<string, string> = {
      frame: "12",
      file: "8",
      blob: "3",
      chip: "13",
    };
    return [
      el("rect", {
        class: `shape ${node.kind}`,
        x: String(box.x),
        y: String(box.y),
        width: String(box.w),
        height: String(box.h),
        rx: rounding[node.kind] ?? "6",
      }),
    ];
  }

  function textFor(node: SceneNode): SVGElement[] {
    const { box } = node;
    const c = centre(box);
    const out: SVGElement[] = [];
    const add = (
      cls: string,
      x: number,
      y: number,
      text: string,
    ): void => {
      const t = el("text", { class: cls, x: String(x), y: String(y) });
      t.textContent = text;
      out.push(t);
    };

    if (node.kind === "frame") {
      // The icon is drawn in both states, from the box the layout chose for it:
      // in a left gutter when open, centred above its own name when closed. One
      // element either way, so the move between them is a transition rather
      // than a disappearance, and an entity can be tracked while it is open.
      const at = node.iconBox ?? box;
      out.push(
        el("path", {
          class: "icon",
          d: ICONS[node.icon ?? "cylinder"],
          transform: `translate(${String(at.x)} ${String(at.y)}) scale(${String(at.w / ICON_GRID)})`,
        }),
      );
      if (node.open === true) {
        // On the head line the layout already reserved, and left-aligned with
        // the contents rather than with the gutter, so the row reads as icon
        // then label then contents.
        add("frame-title", at.x + at.w + 6, box.y + 18, node.title);
        if (node.empty !== undefined) add("empty", c.x, c.y + 12, node.empty);
        return out;
      }
      // Closed, the badge says what is inside, so folding an entity away costs
      // no information.
      add("icon-title", c.x, box.y + box.h - 20, node.title);
      add("icon-badge", c.x, box.y + box.h - 6, node.badge ?? "");
      return out;
    }
    if (node.kind === "file") {
      add("file-name", box.x + 12, c.y + 5, node.title);
      add("file-glyph", box.x + box.w - 14, c.y + 5, node.glyph ?? "");
      return out;
    }
    if (node.kind === "blob") {
      add("oid", c.x, c.y + 4, node.glyph ?? "");
      return out;
    }
    // A commit's swatch is inside the circle and its hex sits under it: the
    // colour carries same-or-different, the text is the supporting detail, and
    // seven characters were never going to fit in 44px.
    if (node.kind === "commit") {
      add("oid", c.x, box.y + box.h + 13, node.glyph ?? "");
      return out;
    }
    add("chip-name", c.x, c.y + 5, node.title);
    return out;
  }

  function addNode(node: SceneNode, entering: boolean): void {
    // A real button, not a click handler on a shape: the marker tabs through
    // this page, and an SVG group has none of that for free.
    const group = el("g", {
      class: "node",
      "data-node": node.id,
      "data-kind": node.kind,
      role: "button",
      tabindex: "0",
      "aria-label": describe(node),
    });
    // Set by a drag that actually moved, so the click it ends with does not
    // also open an inspector on the thing just dropped.
    let dragged = false;
    group.addEventListener("click", () => {
      if (dragged) {
        dragged = false;
        return;
      }
      for (const handler of selectHandlers) handler(node.id);
    });
    if (node.kind === "file") {
      group.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "touch" || dropHandlers.length === 0) return;
        const origin = { x: event.clientX, y: event.clientY };
        group.setPointerCapture(event.pointerId);
        svg.setAttribute("data-dragging", node.id);
        const move = (m: PointerEvent): void => {
          if (Math.hypot(m.clientX - origin.x, m.clientY - origin.y) > 6) {
            dragged = true;
          }
        };
        const up = (u: PointerEvent): void => {
          group.removeEventListener("pointermove", move);
          group.removeEventListener("pointerup", up);
          svg.removeAttribute("data-dragging");
          if (!dragged) return;
          // Whatever is under the finger at the end, walked up to the nearest
          // thing the drawing knows about. Dropping anywhere illegal is simply
          // nothing happening, which is the honest answer.
          const under = document.elementFromPoint(u.clientX, u.clientY);
          const onto = under?.closest("[data-node]") as HTMLElement | null;
          const to = onto?.dataset["node"];
          if (to !== undefined && to !== node.id) {
            for (const handler of dropHandlers) handler(node.id, to);
          }
        };
        group.addEventListener("pointermove", move);
        group.addEventListener("pointerup", up);
      });
    }
    group.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault(); // Space would scroll the page out from under it
      for (const handler of selectHandlers) handler(node.id);
    });
    if (entering) group.setAttribute("data-entering", "true");
    groups.set(node.id, group);
    (node.kind === "frame" ? frameLayer : nodeLayer).append(group);
    // One place builds the children, so a node born mid-interaction is drawn
    // exactly like one that has been re-synced. It was not, and its swatch
    // came out grey while the same commit on the server had its colour.
    updateNode(node);
    if (entering) {
      requestAnimationFrame(() => {
        group.removeAttribute("data-entering");
      });
    }
  }

  function updateNode(node: SceneNode): void {
    const group = groups.get(node.id);
    if (group === undefined) return;
    group.setAttribute("aria-label", describe(node));
    group.setAttribute("data-kind", node.kind);
    // Cleared as well as set: a file that goes back to clean has no letter,
    // and the colour that went with it has to go too.
    if (node.kind === "file") {
      const glyph = node.glyph ?? "";
      if (glyph === "") group.removeAttribute("data-glyph");
      else group.setAttribute("data-glyph", glyph);
    }
    if (node.kind === "frame") {
      group.setAttribute("aria-expanded", String(node.open === true));
    }
    if (node.dotted === true) group.setAttribute("data-dotted", "true");
    // Toggled, not just set: a commit stops being unreachable the moment a
    // branch is pointed back at it, and the drawing has to follow.
    if (node.ghost === true) group.setAttribute("data-ghost", "true");
    else group.removeAttribute("data-ghost");
    if (node.hue !== undefined) {
      group.style.setProperty("--hue", String(node.hue));
    }
    // Geometry is rewritten rather than the group being replaced, so an object
    // the visitor is looking at stays the same element and keeps focus.
    const keep = group.getAttribute("data-open");
    // A frame's outline and icon are carried over rather than rebuilt, so the
    // CSS transition on them has something continuous to animate: the icon
    // slides between gutter and centre, and the box shrinks into it.
    const carried = new Map<string, Element>();
    if (node.kind === "frame") {
      for (const sel of [".shape", ".icon"]) {
        const found = group.querySelector(sel);
        if (found !== null) carried.set(sel, found);
      }
    }
    group.replaceChildren();
    const hit = el("rect", {
      class: "hit",
      x: String(node.hit.x),
      y: String(node.hit.y),
      width: String(node.hit.w),
      height: String(node.hit.h),
      fill: "transparent",
    });
    const parts = [...shapeFor(node), hit, ...textFor(node)].map((fresh) => {
      const sel = fresh.classList.contains("icon")
        ? ".icon"
        : fresh.classList.contains("shape")
          ? ".shape"
          : "";
      const prev = carried.get(sel);
      if (prev === undefined) return fresh;
      for (let i = 0; i < fresh.attributes.length; i += 1) {
        const attr = fresh.attributes[i] as Attr;
        prev.setAttribute(attr.name, attr.value);
      }
      return prev;
    });
    group.append(...parts);
    if (keep !== null) group.setAttribute("data-open", keep);
  }

  function placeLinks(): void {
    const wanted = new Set<string>();
    for (const link of scene.links) {
      const key = `${link.from}:${link.to}`;
      wanted.add(key);
      let line = lines.get(key);
      if (line === undefined) {
        line = el("line", { class: "link" });
        lines.set(key, line);
        linkLayer.append(line);
      }
      line.setAttribute("data-kind", link.kind);
      const from = boxOf(link.from);
      const to = boxOf(link.to);
      if (from === undefined || to === undefined) {
        line.setAttribute("data-hidden", "true");
        continue;
      }
      line.removeAttribute("data-hidden");
      const a = centre(from);
      const b = centre(to);
      // The network link joins the facing edges of the two machines rather
      // than their centres, so the gap is what the eye sees.
      const network = link.kind === "network";
      line.setAttribute("x1", String(a.x));
      line.setAttribute("y1", String(network ? from.y : a.y));
      line.setAttribute("x2", String(b.x));
      line.setAttribute("y2", String(network ? to.y + to.h : b.y));
    }
    for (const [key, line] of lines) {
      if (wanted.has(key)) continue;
      line.remove();
      lines.delete(key);
    }
  }

  // The scene is a diff, not a redraw: what the visitor caused should be
  // visibly what changed.
  function syncTo(next: Scene): void {
    const first = groups.size === 0;
    scene = next;
    byId = new Map(next.nodes.map((n) => [n.id, n]));

    if (opened !== undefined && !byId.has(opened)) closeInspector();

    for (const [id, group] of groups) {
      if (byId.has(id)) continue;
      group.remove();
      groups.delete(id);
    }
    for (const node of next.nodes) {
      if (groups.has(node.id)) updateNode(node);
      else addNode(node, !first);
    }
    // Drawn in scene order, so a frame never paints over what is inside it,
    // and frames stay under the links: a parent line lives between commits
    // that sit inside a filled compartment.
    for (const layer of [frameLayer, nodeLayer]) {
      layer.append(
        ...next.nodes
          .filter((n) => (n.kind === "frame") === (layer === frameLayer))
          .map((n) => groups.get(n.id))
          .filter((g): g is SVGGElement => g !== undefined),
      );
    }

    svg.setAttribute("viewBox", next.viewBox);
    placeLinks();
    for (const [id, note] of notes) {
      const box = boxOf(id);
      if (box !== undefined)
        note.setAttribute("transform", notePlacement(box, note));
    }
    anchor();
    placeHint();
  }

  syncTo(scene);

  const handlers: (() => void)[] = [];
  media.addEventListener("change", (event) => {
    layout = event.matches ? "narrow" : "wide";
    syncTo(make(layout));
    for (const handler of handlers) handler();
  });

  return {
    root: svg,
    get layout() {
      return layout;
    },
    boxOf,
    setScene(next) {
      make = next;
      syncTo(make(layout));
    },
    // The suggestion and the entity it names, set together: the words go
    // beside the picture and the thing itself takes the pale blue border that
    // hover and focus already use, so the sentence has something to point at.
    hint(text: string, at?: string) {
      if (hinted !== undefined) groups.get(hinted)?.removeAttribute("data-hint");
      hinted = at !== undefined && boxOf(at) !== undefined ? at : undefined;
      hintEl.textContent = text;
      hintEl.hidden = text === "" || hinted === undefined;
      if (hinted !== undefined) {
        groups.get(hinted)?.setAttribute("data-hint", "true");
        placeHint();
      }
    },
    sendObject(from, to, kind) {
      const a = boxOf(from);
      const b = boxOf(to);
      if (a === undefined || b === undefined) return;
      const ms = durationFor(kind);
      if (ms === 0) return; // the end state is already drawn
      const start = centre(a);
      const end = centre(b);
      const dot = el("circle", {
        class: "flight",
        "data-kind": kind,
        r: "7",
        cx: String(start.x),
        cy: String(start.y),
      });
      dot.style.setProperty("--flight-ms", `${String(ms)}ms`);
      flightLayer.append(dot);
      requestAnimationFrame(() => {
        dot.setAttribute("data-flying", "true");
        dot.setAttribute("cx", String(end.x));
        dot.setAttribute("cy", String(end.y));
        setTimeout(() => {
          dot.remove();
        }, ms);
      });
    },
    annotate(id, text) {
      const box = boxOf(id);
      if (box === undefined) return;
      notes.get(id)?.remove();
      const existing = timers.get(id);
      if (existing !== undefined) clearTimeout(existing);

      const group = el("g", { class: "note" });
      const label = el("text", { class: "note-text", x: "0", y: "0" });
      label.textContent = text;
      group.append(label);
      noteLayer.append(group);
      // Placed after appending: the text has no measurable width until then.
      group.setAttribute("transform", notePlacement(box, group));
      notes.set(id, group);
      timers.set(
        id,
        window.setTimeout(() => {
          group.remove();
          notes.delete(id);
          timers.delete(id);
        }, ANNOTATION_MS),
      );
    },
    onLayoutChange(handler) {
      handlers.push(handler);
    },
    onDrop(handler) {
      dropHandlers.push(handler);
    },
    onSelect(handler) {
      selectHandlers.push(handler);
    },
    openInspector,
    closeInspector,
    inspecting: () => opened,
  };
}
