import { resolve } from "../dns/resolve.js";
import type { ResolutionResult, ResolutionStep } from "../dns/types.js";
import { playResolution, type Playback } from "../graph/animate.js";
import { createGraph } from "../graph/render.js";
import { DEFAULT_QUERY, ZONES } from "../levels/level1.js";

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

export function start(): void {
  const stage = document.querySelector<HTMLElement>("[data-graph]");
  const form = document.querySelector<HTMLFormElement>("[data-lookup]");
  const input = document.querySelector<HTMLInputElement>("[data-name]");
  const log = document.querySelector<HTMLElement>('[data-testid="output"]');
  if (!stage || !form || !input || !log) return;

  const graph = createGraph(stage);
  let playback: Playback | undefined;

  input.value = DEFAULT_QUERY;

  const run = (name: string): void => {
    playback?.cancel();
    log.replaceChildren();

    const result = resolve({ name, type: "A" }, ZONES);
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
    run(input.value.trim() || DEFAULT_QUERY);
  });

  run(DEFAULT_QUERY);
}
