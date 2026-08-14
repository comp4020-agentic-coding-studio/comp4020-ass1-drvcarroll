import { NO_DEFENCES, type Threat } from "../dns/attack.js";
import { entries } from "../dns/cache.js";
import { SPEEDS } from "../graph/animate.js";
import {
  GROW,
  layout,
  SHRINK,
  type Growable,
  type LayoutName,
  type Scene,
} from "../graph/layout.js";
import { createGraph } from "../graph/render.js";
import type { RecordType } from "../dns/types.js";
import {
  createSim,
  drainPackets,
  reconfigure,
  stepTo,
  type SimState,
} from "../sim/engine.js";
import { LIMITS, type SimConfig } from "../sim/types.js";
import { stepper, switches } from "./controls.js";
import { cacheTable, humanTtl, zoneRecords } from "./records.js";
import { spotlight, type Spotlight } from "./spotlight.js";
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

// Rungs, not ranges. TTL spans a second to a day, and a linear control over
// that spends almost all its travel between values nobody would choose.
const TTLS = [1, 5, 30, 60, 300, 1800, 3600, 21600, 86400];
const RATES = [0.2, 0.5, 1, 2, 5, 10, 20];
// Infinity is the honest top rung: most of this hierarchy has no ceiling worth
// modelling, and "no limit" is a state the visitor has to be able to return to.
const CAPACITIES = [1, 5, 20, 100, 500, Infinity];

const TYPES: { id: RecordType; label: string; note?: string }[] = [
  { id: "A", label: "A — an address" },
  { id: "AAAA", label: "AAAA — an IPv6 address" },
  { id: "MX", label: "MX — where mail goes" },
  { id: "NS", label: "NS — who is in charge", note: "No site here answers this: watch the empty answers climb." },
];

const THREATS: { id: Threat; label: string; note: string }[] = [
  { id: "off", label: "Nobody", note: "Every answer comes from the machine that owns the name." },
  {
    id: "onpath",
    label: "On the path",
    note: "Sees the question, so it never has to guess the number attached to it.",
  },
  {
    id: "offpath",
    label: "Off the path",
    note: "Cannot see the question, so it races the real answer and guesses.",
  },
];

export function start(): void {
  const stage = document.querySelector<HTMLElement>("[data-graph]");
  const readout = document.querySelector<HTMLElement>("[data-headline]");
  const advance = document.querySelector<HTMLButtonElement>("[data-next]");
  const rewind = document.querySelector<HTMLButtonElement>("[data-back]");
  const speed = document.querySelector<HTMLInputElement>("[data-speed]");
  const speedNote = document.querySelector<HTMLElement>("[data-speed-note]");
  if (!stage || !readout || !advance || !rewind || !speed || !speedNote) return;

  const log = document.querySelector<HTMLElement>("[data-log]");
  if (!log) return;

  const state: SimState = createSim(OPENING);
  let rate = SPEEDS[Number(speed.value)] ?? 1;

  // Following one query. The swarm keeps running behind it — only this one
  // message is being walked, and the world does not wait to be watched.
  let live: Spotlight | undefined;

  // Two jobs for two buttons, and which job depends on whether a query is
  // being followed. Stated in one place so the pair cannot drift apart.
  const transport = (): void => {
    if (live === undefined) {
      advance.disabled = rate !== 0;
      advance.title = rate === 0 ? "" : "Pause to step the world by hand";
      rewind.disabled = true;
      rewind.title = "Follow one machine's query to step back through it";
      return;
    }
    advance.disabled = live.at() >= live.total() - 1;
    advance.title = "";
    rewind.disabled = live.at() <= 0;
    rewind.title = "";
  };

  const scene = (name: LayoutName): Scene => layout(state.topology, name);
  const graph = createGraph(stage, scene);

  // What a machine is holding, as opposed to what it just said. Records live
  // on the machine that serves them, and the cache lives on the resolver it
  // belongs to — nothing is restated in a panel beside the picture.
  const inspect = (id: string): void => {
    const body = document.createElement("div");
    body.className = "inspector-body";
    const { config } = state;

    const cache = state.caches.get(id);
    if (cache !== undefined) {
      body.append(
        line(HOLDS_NOTHING.resolver ?? ""),
        cacheTable(entries(cache, state.now), state.now),
      );
      // Both defences are things a resolver does, so this is where they live.
      body.append(
        switches({
          legend: "This resolver's defences",
          kind: "checkbox",
          items: [
            {
              id: "ports",
              label: "Randomise the source port",
              note: "A forgery now has to match a port as well as an ID.",
              on: config.defences.ports,
            },
            {
              id: "dnssec",
              label: "Check signatures (DNSSEC)",
              note: "The forgery still arrives; it is thrown out on its own terms.",
              on: config.defences.dnssec,
            },
          ],
          onToggle: (key, on) => {
            apply({ defences: { ...config.defences, [key]: on } });
          },
        }),
      );
    }

    if (state.topology.resolverOf.has(id)) {
      body.append(line(HOLDS_NOTHING.user ?? ""));
      body.append(
        stepper({
          legend: "Queries per second, each",
          values: RATES,
          at: config.ratePerUser,
          format: (v) => `${String(v)} q/s`,
          onPick: (v) => {
            apply({ ratePerUser: v });
          },
        }),
        switches({
          legend: "What every machine asks for",
          kind: "checkbox",
          items: TYPES.map((t) => ({ ...t, on: config.mix.includes(t.id) })),
          onToggle: (key, on) => {
            const next = on
              ? [...config.mix, key as RecordType]
              : config.mix.filter((t) => t !== key);
            // A silent world is not a configuration, so the last one stays on.
            if (next.length > 0) apply({ mix: next });
          },
        }),
        switches({
          legend: "Who else is answering",
          kind: "radio",
          items: THREATS.map((t) => ({ ...t, on: config.attacker === t.id })),
          onToggle: (key) => {
            apply({ attacker: key as Threat });
          },
        }),
      );
    }

    const served = state.topology.zones.filter((z) => z.server === id);
    for (const zone of served) {
      const heading = document.createElement("h4");
      heading.textContent =
        zone.origin === "."
          ? "Authoritative for the root zone"
          : `Authoritative for ${zone.origin}`;
      // Above the table rather than inside its TTL column: the value is one
      // knob for the whole world, and eight editable cells would imply eight.
      body.append(
        heading,
        stepper({
          legend: "TTL on every record here",
          note: "How long a resolver may keep an answer before asking again.",
          values: TTLS,
          at: config.ttl,
          format: humanTtl,
          onPick: (v) => {
            apply({ ttl: v });
          },
        }),
        zoneRecords(zone.records),
      );
    }

    if (served.length > 0) {
      const ceiling = config.capacity[id] ?? Infinity;
      body.append(
        stepper({
          legend: "What this machine can answer",
          note: "Past its ceiling queries queue, then time out.",
          values: CAPACITIES,
          at: ceiling,
          format: (v) => (v === Infinity ? "no limit" : `${String(v)} q/s`),
          onPick: (v) => {
            const next = { ...config.capacity };
            if (v === Infinity) delete next[id];
            else next[id] = v;
            apply({ capacity: next });
          },
        }),
        switches({
          legend: "Is it up?",
          kind: "checkbox",
          items: [
            {
              id: "offline",
              label: "Take this machine offline",
              note: "Under a long TTL, watch how little happens at first.",
              on: config.offline.includes(id),
            },
          ],
          onToggle: (_key, on) => {
            const next = on
              ? [...config.offline, id]
              : config.offline.filter((s) => s !== id);
            apply({ offline: next });
          },
        }),
      );
    }

    graph.openInspector(id, state.topology.nodes[id]?.title ?? id, body);
  };

  // The world is rebuilt around what changed; the counters keep their history,
  // because what already happened did happen.
  const apply = (patch: Partial<SimConfig>): void => {
    // A knob rebuilds the panel it lives in, so the key that was just pressed
    // has to be found again afterwards or the keyboard is thrown out mid-turn.
    const active = document.activeElement;
    const held =
      active instanceof HTMLElement ? active.getAttribute("aria-label") : null;

    // A walk through the old world says nothing about the new one, and the
    // scene is about to be rebuilt underneath it.
    drop();
    reconfigure(state, { ...state.config, ...patch });
    graph.setScene(scene);
    const open = graph.inspecting();
    if (open !== undefined) inspect(open);
    if (held !== null) {
      const again = stage.querySelector<HTMLElement>(
        `[aria-label="${CSS.escape(held)}"]`,
      );
      again?.focus();
    }
    paint();
  };

  // Growing a tier by pressing the picture. The step is a share of the tier so
  // that reaching a readable crowd is a few presses rather than sixty.
  const step = (field: Growable, direction: number): void => {
    const at = state.config[field];
    const size = Math.max(1, Math.round(at * 0.5));
    const limit = LIMITS[field];
    const next = Math.min(limit.max, Math.max(limit.min, at + size * direction));
    if (next !== at) apply({ [field]: next });
  };

  const drop = (): void => {
    live?.close();
    live = undefined;
    transport();
  };

  const follow = (user: string): void => {
    drop();
    live = spotlight(graph, state, user, log, rate, {
      onSeek: transport,
      onDone: transport,
    });
    transport();
  };

  graph.onNodeSelect((id) => {
    if (id === undefined) {
      drop();
      return;
    }
    if (id.startsWith(GROW)) step(id.slice(GROW.length) as Growable, 1);
    else if (id.startsWith(SHRINK)) step(id.slice(SHRINK.length) as Growable, -1);
    else {
      inspect(id);
      // A machine that asks questions has one to follow; a server is asked.
      if (state.topology.resolverOf.has(id)) follow(id);
      else drop();
    }
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
  // which is one window of the rates the readouts are made of. Following a
  // query it is that query's transport instead — the same verb, one message at
  // a time, which is what the spec asks the primary control to do.
  advance.addEventListener("click", () => {
    if (live !== undefined) {
      live.next();
      return;
    }
    stepTo(state, state.now + 0.25);
    paint();
  });

  rewind.addEventListener("click", () => {
    live?.back();
  });

  speed.addEventListener("input", () => {
    rate = SPEEDS[Number(speed.value)] ?? 0;
    speedNote.textContent = speedName(rate);
    live?.setSpeed(rate);
    transport();
  });

  speedNote.textContent = speedName(rate);
  transport();
  paint();
}
