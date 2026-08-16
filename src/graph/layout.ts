// Where the machines land. The picture is two computers and one gap between
// them: a laptop holding your files, the index and .git, and a server behind a
// dotted line above it. Nothing here draws; it decides what goes where at
// either viewport, with every entity open or closed.

import { hueFor } from "../git/hash.js";
import { ancestry, readCommit } from "../git/objects.js";
import type { World } from "../git/repo.js";
import { headOid } from "../git/repo.js";
import { glyphFor, status } from "../git/status.js";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LayoutName = "wide" | "narrow";

// One shape per idea, and the vocabulary never grows: a frame is a machine or
// a compartment, a file is a file, a blob is content, a commit is a snapshot,
// a chip is a name pointing at one.
export type NodeKind = "frame" | "file" | "blob" | "commit" | "chip";

export interface SceneNode {
  id: string;
  kind: NodeKind;
  title: string;
  // One letter of status, or an oid, drawn on the shape itself.
  glyph?: string;
  // What a closed frame is holding, so folding it away costs no information.
  badge?: string;
  // Said inside an open frame that has nothing in it yet.
  empty?: string;
  hue?: number;
  box: Box;
  // The touch target, which is the drawn box grown to at least 44px. Separate
  // so a ref chip can look like a chip and still be a target on a phone.
  hit: Box;
  open?: boolean;
  dotted?: boolean;
  icon?: IconName;
  parent?: string;
}

export type IconName = "laptop" | "cylinder" | "folder" | "checklist";

export interface Link {
  from: string;
  to: string;
  // The network gap is drawn differently because crossing it is the whole
  // point of view: everything else happens on your laptop.
  kind: "parent" | "pin" | "network";
}

export interface Scene {
  nodes: SceneNode[];
  links: Link[];
  viewBox: string;
}

interface Metrics {
  width: number;
  pad: number;
  gap: number; // between stacked bars inside the laptop
  networkGap: number; // the one boundary traffic crosses
  top: number;
  bottom: number;
  frameHead: number; // room for a frame's own label
  icon: Box;
  file: { w: number; h: number };
  blob: number;
  commit: number; // diameter
  chip: { w: number; h: number };
  pitch: number; // horizontal step between commits
}

const TARGET = 44; // WCAG 2.5.5: nothing interactive smaller than this

const METRICS: Record<LayoutName, Metrics> = {
  wide: {
    width: 1000,
    pad: 20,
    gap: 30,
    networkGap: 72,
    top: 24,
    bottom: 24,
    frameHead: 26,
    icon: { x: 0, y: 0, w: 116, h: 84 },
    file: { w: 168, h: 52 },
    blob: 52,
    commit: 44,
    chip: { w: 92, h: 26 },
    pitch: 116,
  },
  narrow: {
    width: 420,
    pad: 14,
    gap: 22,
    networkGap: 54,
    top: 18,
    bottom: 18,
    frameHead: 24,
    icon: { x: 0, y: 0, w: 104, h: 76 },
    file: { w: 176, h: 52 },
    blob: 52,
    commit: 44,
    chip: { w: 88, h: 26 },
    pitch: 108,
  },
};

// Grown about its own centre to at least 44px each way. A chip stays a chip
// and still answers a thumb.
function hitFor(box: Box): Box {
  const w = Math.max(TARGET, box.w);
  const h = Math.max(TARGET, box.h);
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

const node = (n: Omit<SceneNode, "hit">): SceneNode => ({
  ...n,
  hit: hitFor(n.box),
});

// Split n into rows of at most perRow, as evenly as they divide, so a filling
// compartment stays balanced instead of leaving a stub row.
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

// Lays items left to right in rows inside a frame's content area, and reports
// the height it used. Every compartment fills the same way.
function grid(
  count: number,
  at: { x: number; y: number; w: number },
  item: { w: number; h: number },
  gap: number,
): Box[] {
  const perRow = Math.max(1, Math.floor((at.w + gap) / (item.w + gap)));
  const boxes: Box[] = [];
  let index = 0;
  for (const [row, inRow] of rowSizes(count, perRow).entries()) {
    const span = inRow * item.w + (inRow - 1) * gap;
    const left = at.x + (at.w - span) / 2;
    for (let i = 0; i < inRow; i += 1) {
      if (index >= count) break;
      index += 1;
      boxes.push({
        x: left + i * (item.w + gap),
        y: at.y + row * (item.h + gap),
        w: item.w,
        h: item.h,
      });
    }
  }
  return boxes;
}

function gridHeight(count: number, boxes: Box[], itemH: number): number {
  if (count === 0) return itemH;
  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return bottom - top;
}

export interface Frame {
  id: string;
  title: string;
  icon: IconName;
  dotted?: boolean;
}

const FRAMES: Record<string, Frame> = {
  server: { id: "server", title: "the git server", icon: "cylinder", dotted: true },
  laptop: { id: "laptop", title: "your laptop", icon: "laptop" },
  git: { id: "git", title: ".git", icon: "cylinder" },
  files: { id: "files", title: "your files", icon: "folder" },
  index: { id: "index", title: ".git/index", icon: "checklist" },
};

export const FRAME_IDS = Object.keys(FRAMES);

// A closed frame still says what is inside it.
function badgeFor(world: World, id: string): string {
  const count = (n: number, one: string): string =>
    `${String(n)} ${n === 1 ? one : `${one}s`}`;
  const commitsIn = (repo: World["local"]): number => {
    const head = headOid(repo);
    return head === undefined ? 0 : ancestry(repo.objects, head).length;
  };
  if (id === "files") return count(Object.keys(world.working).length, "file");
  // "staged" is not a noun, so it does not take the plural s.
  if (id === "index") return `${String(Object.keys(world.index).length)} staged`;
  if (id === "server") return count(commitsIn(world.remote), "commit");
  if (id === "git") return count(commitsIn(world.local), "commit");
  // The laptop is a machine, not a store, so it says what the machine holds.
  return `${count(Object.keys(world.working).length, "file")}, ${count(
    commitsIn(world.local),
    "commit",
  )}`;
}

interface Placed {
  nodes: SceneNode[];
  links: Link[];
  height: number;
  // A compartment with nothing in it says so, in one muted line, and stays
  // short. An empty rectangle the size of a full one is wasted surface.
  empty?: string;
}

const EMPTY_ROW = 34;

// A frame either shows its icon or its contents. Both cases return a height,
// so the stack above and below simply moves.
function placeFrame(
  frame: Frame,
  world: World,
  open: ReadonlySet<string>,
  at: { x: number; y: number; w: number },
  m: Metrics,
  fill: (content: { x: number; y: number; w: number }) => Placed,
  parent?: string,
): Placed {
  const isOpen = open.has(frame.id);
  const inner = {
    x: at.x + m.pad,
    y: at.y + m.frameHead,
    w: at.w - m.pad * 2,
  };
  const body: Placed = isOpen
    ? fill(inner)
    : { nodes: [], links: [], height: m.icon.h };

  const height = m.frameHead + body.height + m.pad;
  const box = { x: at.x, y: at.y, w: at.w, h: height };

  const shell = node({
    id: frame.id,
    kind: "frame",
    title: frame.title,
    icon: frame.icon,
    open: isOpen,
    dotted: frame.dotted,
    badge: badgeFor(world, frame.id),
    empty: isOpen ? body.empty : undefined,
    box: isOpen
      ? box
      : // Closed, the frame *is* its icon, centred where the bar would be.
        {
          x: at.x + (at.w - m.icon.w) / 2,
          y: at.y,
          w: m.icon.w,
          h: m.icon.h,
        },
    parent,
  });

  return {
    nodes: [shell, ...body.nodes],
    links: body.links,
    height: isOpen ? height : m.icon.h,
  };
}

function placeFiles(
  world: World,
  content: { x: number; y: number; w: number },
  m: Metrics,
): Placed {
  const files = status(world).filter((s) => s.path in world.working);
  if (files.length === 0) {
    return { nodes: [], links: [], height: EMPTY_ROW, empty: "no files yet" };
  }
  const boxes = grid(files.length, content, m.file, 12);
  return {
    nodes: files.map((s, i) =>
      node({
        id: `file:${s.path}`,
        kind: "file",
        title: s.path,
        glyph: glyphFor(s),
        box: boxes[i] ?? { ...content, ...m.file },
        parent: "files",
      }),
    ),
    links: [],
    height: gridHeight(files.length, boxes, m.file.h),
  };
}

function placeIndex(
  world: World,
  content: { x: number; y: number; w: number },
  m: Metrics,
): Placed {
  const entries = Object.entries(world.index).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const item = { w: m.blob, h: m.blob };
  if (entries.length === 0) {
    return {
      nodes: [],
      links: [],
      height: EMPTY_ROW,
      empty: "nothing staged",
    };
  }
  const boxes = grid(entries.length, content, item, 12);
  return {
    nodes: entries.map(([path, oid], i) =>
      node({
        id: `blob:${oid}`,
        kind: "blob",
        title: path,
        glyph: oid,
        hue: hueFor(oid),
        box: boxes[i] ?? { ...content, ...item },
        parent: "index",
      }),
    ),
    links: [],
    height: gridHeight(entries.length, boxes, item.h),
  };
}

// Oldest on the left, newest on the right, chips pinned above. A horizontal
// chain fits a horizontal bar, and a merge is two lines converging from the
// left with no caption needed.
function placeCommits(
  repoOf: "local" | "remote",
  world: World,
  content: { x: number; y: number; w: number },
  m: Metrics,
): Placed {
  const repo = world[repoOf];
  const head = headOid(repo);
  const chain =
    head === undefined ? [] : [...ancestry(repo.objects, head)].reverse();
  if (chain.length === 0) {
    return {
      nodes: [],
      links: [],
      height: EMPTY_ROW,
      empty: repoOf === "local" ? "no commits yet" : "nothing pushed yet",
    };
  }
  const nodes: SceneNode[] = [];
  const links: Link[] = [];
  const chipRow = content.y;
  const commitRow = chipRow + m.chip.h + 10;
  const span = Math.max(0, chain.length - 1) * m.pitch;
  const left = content.x + Math.max(0, (content.w - span - m.commit) / 2);

  for (const [i, c] of chain.entries()) {
    const id = `${repoOf}:commit:${c.oid}`;
    nodes.push(
      node({
        id,
        kind: "commit",
        title: c.message,
        glyph: c.oid,
        hue: hueFor(c.oid),
        box: {
          x: left + i * m.pitch,
          y: commitRow,
          w: m.commit,
          h: m.commit,
        },
        parent: repoOf === "local" ? "git" : "server",
      }),
    );
    for (const parent of c.parents) {
      if (readCommit(repo.objects, parent) === undefined) continue;
      links.push({
        from: `${repoOf}:commit:${parent}`,
        to: id,
        kind: "parent",
      });
    }
  }

  const at = new Map(chain.map((c, i) => [c.oid, left + i * m.pitch]));
  for (const [name, oid] of Object.entries(repo.refs)) {
    const x = at.get(oid);
    if (x === undefined) continue;
    const id = `${repoOf}:ref:${name}`;
    nodes.push(
      node({
        id,
        kind: "chip",
        title: repoOf === "remote" ? `origin/${name}` : name,
        box: {
          x: x + m.commit / 2 - m.chip.w / 2,
          y: chipRow,
          w: m.chip.w,
          h: m.chip.h,
        },
        parent: repoOf === "local" ? "git" : "server",
      }),
    );
    links.push({ from: id, to: `${repoOf}:commit:${oid}`, kind: "pin" });
  }

  // Room for the oid line printed under each commit.
  return {
    nodes,
    links,
    height: m.chip.h + 10 + m.commit + 16,
  };
}

export function layout(
  world: World,
  open: ReadonlySet<string>,
  name: LayoutName,
): Scene {
  const m = METRICS[name];
  const nodes: SceneNode[] = [];
  const links: Link[] = [];
  const full = { x: m.pad, w: m.width - m.pad * 2 };

  // The server first, because a change travels away from you upward and the
  // reading order should be the same.
  let cursor = m.top;
  const server = placeFrame(
    FRAMES["server"] as Frame,
    world,
    open,
    { ...full, y: cursor },
    m,
    (content) => placeCommits("remote", world, content, m),
  );
  nodes.push(...server.nodes);
  links.push(...server.links);
  cursor += server.height + m.networkGap;

  // Everything below here is one machine, and drawing .git inside it is the
  // whole argument against "my code lives on GitHub".
  const laptopTop = cursor;
  const laptop = placeFrame(
    FRAMES["laptop"] as Frame,
    world,
    open,
    { ...full, y: laptopTop },
    m,
    (inside) => {
      const inner: SceneNode[] = [];
      const innerLinks: Link[] = [];
      let y = inside.y;

      const git = placeFrame(
        FRAMES["git"] as Frame,
        world,
        open,
        { x: inside.x, y, w: inside.w },
        m,
        (content) => placeCommits("local", world, content, m),
        "laptop",
      );
      inner.push(...git.nodes);
      innerLinks.push(...git.links);
      y += git.height + m.gap;

      // Your files and the index share one row: the index is a file on the
      // same machine, so staging is a short move sideways, not a journey.
      const side = name === "narrow" ? inside.w : (inside.w - m.gap) / 2;
      const files = placeFrame(
        FRAMES["files"] as Frame,
        world,
        open,
        { x: inside.x, y, w: side },
        m,
        (content) => placeFiles(world, content, m),
        "laptop",
      );
      const indexTop = name === "narrow" ? y + files.height + m.gap : y;
      const indexLeft = name === "narrow" ? inside.x : inside.x + side + m.gap;
      const index = placeFrame(
        FRAMES["index"] as Frame,
        world,
        open,
        { x: indexLeft, y: indexTop, w: side },
        m,
        (content) => placeIndex(world, content, m),
        "laptop",
      );
      inner.push(...files.nodes, ...index.nodes);
      innerLinks.push(...files.links, ...index.links);

      const bottom =
        name === "narrow"
          ? indexTop + index.height
          : y + Math.max(files.height, index.height);
      return { nodes: inner, links: innerLinks, height: bottom - inside.y };
    },
  );
  nodes.push(...laptop.nodes);
  links.push(...laptop.links);
  cursor = laptopTop + laptop.height;

  links.push({ from: "laptop", to: "server", kind: "network" });

  const height = Math.round(cursor + m.bottom);

  // Crop to what is actually drawn. Two icons in a 1000-wide box render tiny
  // with the rest empty, and empty is as much a failure as cluttered. Nothing
  // moves; the window onto it just tightens, so the canvas visibly grows as
  // entities open.
  const left = Math.min(...nodes.map((n) => Math.min(n.box.x, n.hit.x)));
  const right = Math.max(
    ...nodes.map((n) => Math.max(n.box.x + n.box.w, n.hit.x + n.hit.w)),
  );
  const x = Math.round(Math.max(0, left - m.pad));
  const w = Math.round(Math.min(m.width - x, right - x + m.pad));

  return {
    nodes,
    links,
    viewBox: `${String(x)} 0 ${String(w)} ${String(height)}`,
  };
}

export { METRICS, TARGET };
