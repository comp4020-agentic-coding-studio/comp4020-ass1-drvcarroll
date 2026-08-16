import { describe, expect, it } from "vitest";
import type { Box, LayoutName, SceneNode } from "../src/graph/layout.js";
import { FRAME_IDS, TARGET, layout } from "../src/graph/layout.js";
import type { World } from "../src/git/repo.js";
import {
  commitIndex,
  edit,
  emptyWorld,
  headOid,
  stage,
} from "../src/git/repo.js";
import { rebase } from "../src/git/rebase.js";
import { fetch, push, teammatePushes } from "../src/git/remote.js";

// Both viewports are marked in full, so neither is a fallback for the other,
// and every entity can be open or closed. That is 32 pictures per viewport,
// and all of them have to be a picture.

const VIEWPORTS: LayoutName[] = ["wide", "narrow"];

// Enough of a world that every compartment has something in it.
function busyWorld(): World {
  let world = emptyWorld();
  world = stage(edit(world, "README.md", "# my project"), "README.md");
  world = commitIndex(world, "first");
  world = stage(edit(world, "main.ts", "console.log(1)"), "main.ts");
  world = commitIndex(world, "second");
  world = edit(world, "notes.md", "unstaged");
  world = stage(edit(world, "main.ts", "console.log(2)"), "main.ts");
  return world;
}

// Every subset of the five entities, as a set of open ids.
const COMBINATIONS: Set<string>[] = Array.from(
  { length: 2 ** FRAME_IDS.length },
  (_, mask) =>
    new Set(FRAME_IDS.filter((_id, bit) => (mask & (1 << bit)) !== 0)),
);

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const contains = (outer: Box, inner: Box): boolean =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.w <= outer.x + outer.w + 0.5 &&
  inner.y + inner.h <= outer.y + outer.h + 0.5;

const find = (nodes: SceneNode[], id: string): SceneNode | undefined =>
  nodes.find((n) => n.id === id);

describe.each(VIEWPORTS)("the picture at %s", (name) => {
  it.each(COMBINATIONS.map((open, i) => [i, open] as const))(
    "keeps everything inside the viewBox, combination %i",
    (_i, open) => {
      const scene = layout(busyWorld(), open, name);
      const [x0 = 0, y0 = 0, w = 0, h = 0] = scene.viewBox
        .split(/\s+/)
        .map(Number);
      for (const node of scene.nodes) {
        expect(
          node.box.x >= x0 &&
            node.box.y >= y0 &&
            node.box.x + node.box.w <= x0 + w &&
            node.box.y + node.box.h <= y0 + h,
          `${node.id} is drawn outside the viewBox`,
        ).toBe(true);
      }
    },
  );

  it.each(COMBINATIONS.map((open, i) => [i, open] as const))(
    "never overlaps two things of the same kind, combination %i",
    (_i, open) => {
      const scene = layout(busyWorld(), open, name);
      const kinds = ["file", "blob", "commit", "chip"] as const;
      for (const kind of kinds) {
        const same = scene.nodes.filter((n) => n.kind === kind);
        for (const [i, a] of same.entries()) {
          for (const b of same.slice(i + 1)) {
            expect(
              overlaps(a.box, b.box),
              `${a.id} overlaps ${b.id}`,
            ).toBe(false);
          }
        }
      }
    },
  );

  it.each(COMBINATIONS.map((open, i) => [i, open] as const))(
    "gives every interactive thing a 44px target, combination %i",
    (_i, open) => {
      for (const node of layout(busyWorld(), open, name).nodes) {
        expect(
          Math.min(node.hit.w, node.hit.h),
          `${node.id} is smaller than a thumb`,
        ).toBeGreaterThanOrEqual(TARGET);
      }
    },
  );

  it("draws .git inside the laptop, which is the whole argument", () => {
    const open = new Set(["laptop", "git", "files", "index"]);
    const scene = layout(busyWorld(), open, name);
    const laptop = find(scene.nodes, "laptop");
    for (const id of ["git", "files", "index"]) {
      const inner = find(scene.nodes, id);
      expect(
        laptop !== undefined &&
          inner !== undefined &&
          contains(laptop.box, inner.box),
        `${id} is drawn outside the laptop`,
      ).toBe(true);
    }
  });

  it("keeps the server outside the laptop, across the gap", () => {
    const scene = layout(busyWorld(), new Set(FRAME_IDS), name);
    const laptop = find(scene.nodes, "laptop");
    const server = find(scene.nodes, "server");
    expect(server !== undefined && laptop !== undefined).toBe(true);
    expect(overlaps(server?.box ?? { x: 0, y: 0, w: 0, h: 0 }, laptop?.box ?? { x: 0, y: 0, w: 0, h: 0 })).toBe(false);
  });

  it("puts everything in a frame inside that frame", () => {
    const scene = layout(busyWorld(), new Set(FRAME_IDS), name);
    for (const node of scene.nodes) {
      if (node.parent === undefined) continue;
      const frame = find(scene.nodes, node.parent);
      if (frame === undefined || frame.open !== true) continue;
      expect(
        contains(frame.box, node.box),
        `${node.id} escapes ${node.parent}`,
      ).toBe(true);
    }
  });

  it("shrinks back to two icons when nothing is open", () => {
    const scene = layout(busyWorld(), new Set(), name);
    expect(scene.nodes.map((n) => n.id)).toEqual(["server", "laptop"]);
  });

  it("still says what a closed entity is holding", () => {
    const scene = layout(busyWorld(), new Set(), name);
    expect(
      find(scene.nodes, "laptop")?.badge,
      "Folding a machine away must not fold away what is in it.",
    ).toBe("3 files, 2 commits");
    expect(find(scene.nodes, "server")?.badge).toBe("0 commits");
  });

  it("crops to what is drawn, so two icons are not lost in a wide box", () => {
    const width = (open: Set<string>): number =>
      Number(layout(busyWorld(), open, name).viewBox.split(/\s+/)[2]);
    expect(width(new Set())).toBeLessThan(width(new Set(FRAME_IDS)));
  });

  it("says so when an open compartment is empty, and stays short", () => {
    const open = new Set(["laptop", "git"]);
    const tall = layout(busyWorld(), open, name);
    const bare = layout(emptyWorld(), open, name);
    expect(find(bare.nodes, "git")?.empty).toBe("no commits yet");
    expect(find(bare.nodes, "git")?.box.h).toBeLessThan(
      find(tall.nodes, "git")?.box.h ?? 0,
    );
  });
});

describe("the commit chain", () => {
  const scene = layout(busyWorld(), new Set(["laptop", "git"]), "wide");

  // Emission order is by lane now that a diverged history draws two of them,
  // so the claim is about the drawing: a child is always right of its parent.
  it("runs oldest to newest, left to right", () => {
    const x = (id: string): number =>
      scene.nodes.find((n) => n.id === id)?.box.x ?? 0;
    for (const link of scene.links.filter((l) => l.kind === "parent")) {
      expect(x(link.to)).toBeGreaterThan(x(link.from));
    }
  });

  // The whole lesson of a refused push is that the server holds a commit you
  // do not. If only HEAD's own line is drawn, that commit is invisible.
  it("draws every tip, not only the one HEAD is on", () => {
    const world = fetch(
      teammatePushes(push(busyWorld()), "README.md", "theirs", "theirs"),
    );
    const scene = layout(world, new Set(["laptop", "git"]), "wide");
    const chips = scene.nodes.filter((n) => n.kind === "chip");
    expect(chips.map((c) => c.title)).toContain("origin/main");
    const theirs = chips.find((c) => c.title === "origin/main") as SceneNode;
    const mine = chips.find((c) => c.title === "main") as SceneNode;
    // Two lanes: their tip is drawn somewhere ours is not.
    expect(theirs.box.y).not.toBe(mine.box.y);
  });

  // A commit nothing points at is still in .git, so it is still drawn - faint.
  // A rebase that made its old line vanish would teach that the work was lost.
  it("keeps a rebased-away commit on the canvas, ghosted", () => {
    const mine = commitIndex(
      stage(edit(emptyWorld(), "README.md", "mine\n"), "README.md"),
      "mine",
    );
    // Diverged for real: they committed on the server after I pushed, and I
    // committed again here. Neither line contains the other.
    const shared = fetch(
      teammatePushes(push(mine), "notes.md", "theirs\n", "theirs"),
    );
    const before = commitIndex(
      stage(edit(shared, "mine.md", "later\n"), "mine.md"),
      "later",
    );
    const was = headOid(before.local) as string;
    const after = rebase(before, "origin/main");
    const scene = layout(after, new Set(["laptop", "git"]), "wide");
    const drawn = (oid: string): SceneNode | undefined =>
      scene.nodes.find((n) => n.id === `local:commit:${oid}`);
    expect(drawn(was)?.ghost).toBe(true);
    expect(drawn(headOid(after.local) as string)?.ghost).toBe(false);
  });

  it("draws a line from each commit to its parent", () => {
    expect(scene.links.filter((l) => l.kind === "parent")).toHaveLength(1);
  });

  it("pins the branch name to a commit", () => {
    expect(scene.links.some((l) => l.kind === "pin")).toBe(true);
  });

  it("gives two different oids two different hues", () => {
    const hues = scene.nodes
      .filter((n) => n.kind === "commit")
      .map((n) => n.hue);
    expect(new Set(hues).size).toBe(hues.length);
  });
});
