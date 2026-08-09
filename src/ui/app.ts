import { buildZones } from "../dns/live.js";
import { resolve } from "../dns/resolve.js";
import type { ResolutionResult, ResolutionStep, Zone } from "../dns/types.js";
import { playResolution, type Playback } from "../graph/animate.js";
import { createGraph } from "../graph/render.js";
import {
  DEFAULT_QUERY,
  KNOWN_NAMES,
  ZONES as FALLBACK_ZONES,
} from "../levels/level1.js";

const STEP_LABEL: Record<ResolutionStep["kind"], string> = {
  query: "Question",
  referral: "Referral",
  answer: "Answer",
  nxdomain: "No such name",
};

// The payoff: DNS is finished, so the browser can finally open a connection.
// Not a DNS message, which is why it is added here rather than in resolve().
function connectionStep(result: ResolutionResult): ResolutionStep[] {
  if (result.outcome !== "answered") return [];
  const address = result.answer[0]?.data ?? "";
  return [
    {
      from: "stub",
      to: "origin",
      kind: "query",
      records: [],
      note: `Now the browser can connect to ${address}`,
    },
  ];
}

function stepRow(step: ResolutionStep, index: number): HTMLLIElement {
  const row = document.createElement("li");
  row.className = "step";
  row.dataset.kind = step.kind;

  const label = document.createElement("span");
  label.className = "step-label";
  label.textContent = `${String(index + 1)}. ${STEP_LABEL[step.kind]}`;

  const note = document.createElement("span");
  note.className = "step-note";
  note.textContent = step.note;

  row.append(label, note);
  return row;
}

const SOURCE_NOTE: Record<string, string> = {
  loading: "Asking the real DNS…",
  live: "Real delegation data, fetched live over DNS-over-HTTPS. The names, addresses and TTLs below are genuine; the order of the walk is reconstructed, because a browser cannot watch a resolver work.",
  fallback: "The network did not answer, so this is a stored miniature internet. Only anu.edu.au and google.com exist in it.",
};

// A browser cannot observe referrals, so real zone data is fetched and the
// walk is rebuilt from it. When that fails the canned world stands in — the
// page must still teach with the network unplugged.
async function zonesFor(
  name: string,
  cache: Map<string, Zone[]>,
): Promise<{ zones: Zone[]; source: "live" | "fallback" }> {
  const hit = cache.get(name);
  if (hit) return { zones: hit, source: "live" };
  try {
    const { zones } = await buildZones(name);
    cache.set(name, zones);
    return { zones, source: "live" };
  } catch {
    return { zones: FALLBACK_ZONES, source: "fallback" };
  }
}

export function start(): void {
  const stage = document.querySelector<HTMLElement>("[data-graph]");
  const form = document.querySelector<HTMLFormElement>("[data-lookup]");
  const input = document.querySelector<HTMLInputElement>("[data-name]");
  const log = document.querySelector<HTMLElement>('[data-testid="output"]');
  const source = document.querySelector<HTMLElement>("[data-source]");
  if (!stage || !form || !input || !log || !source) return;

  const graph = createGraph(stage);
  let playback: Playback | undefined;

  const options = document.createElement("datalist");
  options.id = "known-names";
  for (const name of KNOWN_NAMES) {
    const option = document.createElement("option");
    option.value = name;
    options.append(option);
  }
  input.setAttribute("list", options.id);
  input.after(options);
  input.value = DEFAULT_QUERY;

  const cache = new Map<string, Zone[]>();
  let token = 0;

  const run = async (name: string): Promise<void> => {
    playback?.cancel();
    log.replaceChildren();
    source.dataset.state = "loading";
    source.textContent = SOURCE_NOTE.loading ?? "";

    const mine = (token += 1);
    const { zones, source: origin } = await zonesFor(name, cache);
    if (mine !== token) return; // a newer lookup already started

    source.dataset.state = origin;
    source.textContent = SOURCE_NOTE[origin] ?? "";

    const result = resolve({ name, type: "A" }, zones);
    const steps = [...result.steps, ...connectionStep(result)];

    const list = document.createElement("ol");
    list.className = "steps";
    log.append(list);

    playback = playResolution(graph, steps, {
      onStep(step, index) {
        list.append(stepRow(step, index));
      },
      onDone() {
        const summary = document.createElement("p");
        summary.className = "summary";
        summary.dataset.outcome = result.outcome;
        summary.textContent =
          result.outcome === "answered"
            ? `Resolved in ${String(result.steps.length)} messages — and your machine sent only one of them.`
            : `${result.question.name} does not exist.`;
        log.append(summary);
      },
    });
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void run(input.value.trim() || DEFAULT_QUERY);
  });

  void run(DEFAULT_QUERY);
}
