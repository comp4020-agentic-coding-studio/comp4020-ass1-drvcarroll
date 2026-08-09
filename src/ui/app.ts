import { buildZones } from "../dns/live.js";
import { resolve } from "../dns/resolve.js";
import type {
  DNSRecord,
  RecordType,
  ResolutionResult,
  ResolutionStep,
  Zone,
} from "../dns/types.js";
import { playResolution, type Playback } from "../graph/animate.js";
import { createGraph } from "../graph/render.js";
import { LEVEL1 } from "../levels/level1.js";
import { LEVEL2 } from "../levels/level2.js";
import type { LevelConfig } from "../levels/types.js";
import { recordTable, type Seen } from "./records.js";

const LEVELS: LevelConfig[] = [LEVEL1, LEVEL2];

const STEP_LABEL: Record<ResolutionStep["kind"], string> = {
  query: "Question",
  referral: "Referral",
  answer: "Answer",
  cname: "Alias",
  nxdomain: "No such name",
};

// MX rdata is a priority and a hostname in one string. Only the tail is a
// name you could connect to; an address has no priority to strip.
const hostOf = (record: DNSRecord): string =>
  record.data.split(" ").at(-1) ?? record.data;

// The payoff: DNS is finished, so something can finally open a connection.
// Not a DNS message, which is why it is added here rather than in resolve().
// A type with no destination gets no step — NS and SOA are not somewhere to go.
function connectionStep(
  result: ResolutionResult,
  level: LevelConfig,
): ResolutionStep[] {
  const to = level.destinations[result.question.type];
  const answer = result.answer[0];
  if (result.outcome !== "answered" || to === undefined || !answer) return [];
  return [
    {
      from: "stub",
      to,
      kind: "query",
      records: [],
      note: `Now the browser can connect to ${hostOf(answer)}`,
    },
  ];
}

function stepRow(step: ResolutionStep, index: number, seen: Seen): HTMLLIElement {
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
  if (step.records.length > 0) {
    row.append(recordTable(step.records, step.kind, seen));
  }
  return row;
}

const SOURCE_NOTE: Record<string, string> = {
  loading: "Asking the real DNS…",
  live: "Real delegation data, fetched live over DNS-over-HTTPS. The names, addresses and TTLs below are genuine; the order of the walk is reconstructed, because a browser cannot watch a resolver work.",
  fallback:
    "The network did not answer, so this is a stored miniature internet. Only anu.edu.au and google.com exist in it.",
};

// A browser cannot observe referrals, so real zone data is fetched and the
// walk is rebuilt from it. When that fails the canned world stands in — the
// page must still teach with the network unplugged.
async function zonesFor(
  name: string,
  type: RecordType,
  level: LevelConfig,
  cache: Map<string, Zone[]>,
): Promise<{ zones: Zone[]; source: "live" | "fallback" }> {
  const key = `${name}|${type}`;
  const hit = cache.get(key);
  if (hit) return { zones: hit, source: "live" };
  try {
    const { zones } = await buildZones(name, type);
    cache.set(key, zones);
    return { zones, source: "live" };
  } catch {
    return { zones: level.zones, source: "fallback" };
  }
}

export function start(): void {
  const stage = document.querySelector<HTMLElement>("[data-graph]");
  const nav = document.querySelector<HTMLElement>("[data-levels]");
  const form = document.querySelector<HTMLFormElement>("[data-lookup]");
  const input = document.querySelector<HTMLInputElement>("[data-name]");
  const picker = document.querySelector<HTMLSelectElement>("[data-type]");
  const log = document.querySelector<HTMLElement>('[data-testid="output"]');
  const source = document.querySelector<HTMLElement>("[data-source]");
  if (!stage || !nav || !form || !input || !picker || !log || !source) return;

  let level = LEVELS[0] ?? LEVEL1;
  const graph = createGraph(stage, level);
  let playback: Playback | undefined;

  const options = document.createElement("datalist");
  options.id = "known-names";
  input.setAttribute("list", options.id);
  input.after(options);

  const cache = new Map<string, Zone[]>();
  let token = 0;

  const run = async (name: string, type: RecordType): Promise<void> => {
    playback?.cancel();
    log.replaceChildren();
    source.dataset.state = "loading";
    source.textContent = SOURCE_NOTE.loading ?? "";

    const mine = (token += 1);
    const { zones, source: origin } = await zonesFor(name, type, level, cache);
    if (mine !== token) return; // a newer lookup already started

    source.dataset.state = origin;
    source.textContent = SOURCE_NOTE[origin] ?? "";

    const result = resolve({ name, type }, zones);
    const steps = [...result.steps, ...connectionStep(result, level)];

    const list = document.createElement("ol");
    list.className = "steps";
    log.append(list);

    // One walk, one set: a term is explained where it first appears and the
    // later hops stay readable.
    const seen: Seen = new Set();

    playback = playResolution(graph, steps, {
      onStep(step, index) {
        list.append(stepRow(step, index, seen));
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

  const submit = (): void => {
    const type = (picker.value || level.types[0] || "A") as RecordType;
    void run(input.value.trim() || level.defaultQuery, type);
  };

  // A level reconfigures the one page: graph, picker, examples and prose.
  // Nothing is replaced wholesale, so what a level added stays visible.
  // An arrow, not a declaration: hoisting would discard the null narrowing
  // the querySelector guard above just established.
  const apply = (next: LevelConfig): void => {
    level = next;
    graph.setLevel(next);

    for (const button of nav.querySelectorAll("button")) {
      button.setAttribute(
        "aria-current",
        button.dataset.level === next.id ? "true" : "false",
      );
    }

    options.replaceChildren(
      ...next.knownNames.map((name) => {
        const option = document.createElement("option");
        option.value = name;
        return option;
      }),
    );

    // One type means the question never varies, so the control would be a
    // decision the visitor is not being offered.
    picker.hidden = next.types.length < 2;
    picker.replaceChildren(
      ...next.types.map((type) => {
        const option = document.createElement("option");
        option.value = type;
        option.textContent = type;
        return option;
      }),
    );

    for (const notes of document.querySelectorAll<HTMLElement>("[data-notes]")) {
      notes.hidden = notes.dataset.notes !== next.id;
    }

    input.value = next.defaultQuery;
    submit();
  };

  for (const config of LEVELS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.level = config.id;
    button.textContent = `${config.id.toUpperCase()} — ${config.title}`;
    button.addEventListener("click", () => {
      apply(config);
    });
    nav.append(button);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  picker.addEventListener("change", submit);

  apply(level);
}
