import { NO_DEFENCES } from "../dns/attack.js";
import { entries } from "../dns/cache.js";
import { SPEEDS } from "../graph/animate.js";
import { layout, type LayoutName, type Scene } from "../graph/layout.js";
import { createGraph } from "../graph/render.js";
import {
  createSim,
  drainPackets,
  stepTo,
  type SimState,
} from "../sim/engine.js";
import type { SimConfig } from "../sim/types.js";
import { cacheTable, zoneRecords } from "./records.js";
import { band, headline, intensity, nodeMetric } from "./readouts.js";

// The page opens on the smallest network that is still DNS: one of everything.
// Growth is the interaction, so it cannot be the starting state.
const OPENING: SimConfig = {
  seed: 1,
  users: 1,
  resolvers: 1,
  authorities: 1,
  ratePerUser: 1,
  ttl: 300,
  mix: ["A"],
  attacker: "off",
  defences: { ...NO_DEFENCES },
  capacity: {},
  offline: [],
};

// A frame that took longer than this was a backgrounded tab, not slow work.
// Simulating the whole gap would dump minutes of load in one step.
const MAX_FRAME = 250;

// How often the readouts and the shading are refreshed, in wall time. Ten a
// second reads as live; sixty would be sixty times the style writes.
const PAINT_MS = 100;

const speedName = (rate: number): string =>
  rate === 0 ? "Paused" : `${String(rate)}× time`;

function line(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
}

// Machines that hold no zone data still have to answer for themselves — an
// empty panel would read as a bug rather than as the point.
const HOLDS_NOTHING: Record<string, string> = {
  user: "Your machine holds nothing. It knows one thing: which resolver to ask. One question out, one answer back — everything else here happened on its behalf.",
  resolver:
    "A resolver has authority over nothing. Everything below is borrowed, with a clock on it, and every entry here is a question the servers above never had to answer.",
};

export function start(): void {
  const stage = document.querySelector<HTMLElement>("[data-graph]");
  const readout = document.querySelector<HTMLElement>("[data-headline]");
  const advance = document.querySelector<HTMLButtonElement>("[data-next]");
  const rewind = document.querySelector<HTMLButtonElement>("[data-back]");
  const speed = document.querySelector<HTMLInputElement>("[data-speed]");
  const speedNote = document.querySelector<HTMLElement>("[data-speed-note]");
  if (!stage || !readout || !advance || !rewind || !speed || !speedNote) return;

  const state: SimState = createSim(OPENING);
  let rate = SPEEDS[Number(speed.value)] ?? 1;

  const scene = (name: LayoutName): Scene => layout(state.topology, name);
  const graph = createGraph(stage, scene);

  // What a machine is holding, as opposed to what it just said. Records live
  // on the machine that serves them, and the cache lives on the resolver it
  // belongs to — nothing is restated in a panel beside the picture.
  const inspect = (id: string): void => {
    const body = document.createElement("div");
    body.className = "inspector-body";

    const cache = state.caches.get(id);
    if (cache !== undefined) {
      body.append(cacheTable(entries(cache, state.now), state.now));
    }

    for (const zone of state.topology.zones.filter((z) => z.server === id)) {
      const heading = document.createElement("h4");
      heading.textContent =
        zone.origin === "."
          ? "Authoritative for the root zone"
          : `Authoritative for ${zone.origin}`;
      body.append(heading, zoneRecords(zone.records));
    }

    if (body.childElementCount === 0) {
      const kind = id.startsWith("u") ? "user" : "resolver";
      body.append(line(HOLDS_NOTHING[kind] ?? "Holds no zone data."));
    }

    graph.openInspector(id, state.topology.nodes[id]?.title ?? id, body);
  };

  graph.onNodeSelect((id) => {
    if (id !== undefined) inspect(id);
  });

  const paint = (): void => {
    for (const [key, stat] of state.edges) {
      const [from, to] = key.split(":");
      if (from === undefined || to === undefined) continue;
      graph.setEdgeLoad(from, to, intensity(stat.rate), band(stat.rate));
    }
    // The load on a machine, written on the machine. Users are dots and carry
    // no text, so this reaches exactly the tiers whose rate is the argument.
    for (const id of Object.keys(state.topology.nodes)) {
      graph.setNodeMetric(id, nodeMetric(state, id));
    }
    for (const packet of drainPackets(state)) {
      graph.sendPacket(packet.from, packet.to, packet.kind);
    }
    readout.textContent = headline(state);
  };

  let last = performance.now();
  let painted = 0;

  const frame = (at: number): void => {
    const wall = Math.min(at - last, MAX_FRAME);
    last = at;
    if (rate > 0) stepTo(state, state.now + (wall / 1000) * rate);
    if (at - painted >= PAINT_MS) {
      painted = at;
      paint();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Paused, the transport is the clock: one quarter-second of world per press,
  // which is one window of the rates the readouts are made of.
  advance.addEventListener("click", () => {
    stepTo(state, state.now + 0.25);
    paint();
  });

  // Nothing to seek back through until a single query is being followed.
  rewind.disabled = true;
  rewind.title = "Follow one query to step back through it";

  speed.addEventListener("input", () => {
    rate = SPEEDS[Number(speed.value)] ?? 0;
    speedNote.textContent = speedName(rate);
    advance.disabled = rate !== 0;
  });

  speedNote.textContent = speedName(rate);
  advance.disabled = rate !== 0;
  paint();
}
