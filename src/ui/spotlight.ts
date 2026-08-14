import type { ResolutionResult, ResolutionStep } from "../dns/types.js";
import { playResolution, type Playback } from "../graph/animate.js";
import type { Graph } from "../graph/render.js";
import { previewQuery, type SimState } from "../sim/engine.js";
import type { NodeId } from "../dns/types.js";
import { recordTable, type Seen } from "./records.js";

// Following one query while the swarm keeps running. The aggregate view says
// how much work the hierarchy is doing; it cannot say what one of those
// messages is. This is the same walk the four levels used to narrate, on
// demand and against the world the visitor built — which is why the page can
// open at one node per tier without explaining a referral in prose.

const STEP_LABEL: Record<string, string> = {
  query: "Question",
  referral: "Referral",
  answer: "Answer",
  cname: "Alias",
  nodata: "No such record",
  nxdomain: "No such name",
  timeout: "No reply",
  cached: "From cache",
  forged: "Forged — believed",
  rejected: "Forged — discarded",
};

const OUTCOME_NOTE: Record<ResolutionResult["outcome"], (q: string) => string> =
  {
    answered: (q) => `Resolved ${q}.`,
    // Said plainly, because "does not exist" here would simply be false.
    nodata: (q) => `${q} exists. It just has no record of that type.`,
    nxdomain: (q) => `${q} does not exist.`,
    // Unanswered is not absent: the name may be fine and the server down.
    timeout: (q) => `Nobody answered for ${q}.`,
  };

// A message only counts as sent if it crossed an edge. A cached step has the
// resolver at both ends, which is precisely why it costs nothing.
const sent = (steps: ResolutionStep[]): number =>
  steps.filter((step) => step.from !== step.to).length;

const hex = (value: number): string =>
  `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;

// The transcript is also the scrubber, so a row exists for every message from
// the start — but an unreached one shows only its number. Knowing there are
// nine messages left is the useful part; reading them early is not.
function placeholderRow(index: number, seek: () => void): HTMLLIElement {
  const row = document.createElement("li");
  row.className = "step";
  row.dataset.reached = "false";

  // A button rather than a handler on the row: seeking back has to work from
  // the keyboard, and a records table cannot live inside a button.
  const seat = document.createElement("button");
  seat.type = "button";
  seat.className = "step-seek";
  seat.disabled = true;

  const label = document.createElement("span");
  label.className = "step-label";
  label.textContent = String(index + 1);

  const note = document.createElement("span");
  note.className = "step-note";

  seat.append(label, note);
  seat.addEventListener("click", seek);
  row.append(seat);
  return row;
}

function fillRow(
  row: HTMLLIElement,
  step: ResolutionStep,
  index: number,
  seen: Seen,
): void {
  row.dataset.kind = step.kind;
  row.dataset.reached = "true";

  const seat = row.querySelector("button");
  const label = row.querySelector(".step-label");
  const note = row.querySelector(".step-note");
  if (!seat || !label || !note) return;

  seat.disabled = false;
  seat.setAttribute("aria-label", `Message ${String(index + 1)}`);
  label.textContent = `${String(index + 1)}. ${STEP_LABEL[step.kind] ?? step.kind}`;
  note.textContent = step.note;

  // The acceptance test, shown as the number it actually is.
  if (step.txid !== undefined) {
    const id = document.createElement("span");
    id.className = "step-txid";
    id.textContent = hex(step.txid);
    seat.append(id);
  }

  if (step.records.length > 0) {
    row.append(recordTable(step.records, step.kind, seen));
  }
}

export interface Spotlight {
  next(): void;
  back(): void;
  setSpeed(rate: number): void;
  // How far the visitor has walked, so the transport can disable itself at
  // the ends rather than offering presses that do nothing.
  at(): number;
  total(): number;
  close(): void;
}

export interface SpotlightHooks {
  onSeek(): void;
  onDone(): void;
}

export function spotlight(
  graph: Graph,
  state: SimState,
  user: NodeId,
  log: HTMLElement,
  rate: number,
  hooks: SpotlightHooks,
): Spotlight | undefined {
  const result = previewQuery(state, user);
  if (result === undefined) return undefined;

  const steps = result.steps;
  log.replaceChildren();
  const list = document.createElement("ol");
  list.className = "steps";
  log.append(list);

  let here = -1;
  let playback: Playback | undefined;

  const rows = steps.map((_, index) =>
    placeholderRow(index, () => {
      playback?.seek(index);
    }),
  );
  list.append(...rows);

  // One walk, one set: a term is explained where it first appears and the
  // later hops stay readable.
  const seen: Seen = new Set();

  graph.setSpotlight(true);
  playback = playResolution(
    graph,
    steps,
    {
      onSeek(index, furthest) {
        here = index;
        for (let i = 0; i <= furthest; i += 1) {
          const row = rows[i];
          const step = steps[i];
          if (row === undefined || step === undefined) continue;
          if (row.dataset.reached !== "true") fillRow(row, step, i, seen);
          row.dataset.current = String(i === index);
        }
        hooks.onSeek();
        if (index > 0) rows[index]?.scrollIntoView({ block: "nearest" });
      },
      onDone() {
        const summary = document.createElement("p");
        summary.className = "summary";
        summary.dataset.outcome = result.outcome;
        const crossed = sent(steps);
        summary.textContent =
          result.outcome === "answered"
            ? `${OUTCOME_NOTE.answered(result.question.name)} ${String(crossed)} messages crossed the network, and this machine sent one of them.`
            : OUTCOME_NOTE[result.outcome](result.question.name);
        log.append(summary);
        hooks.onDone();
      },
    },
    rate,
  );

  return {
    next: () => {
      playback?.next();
    },
    back: () => {
      playback?.back();
    },
    setSpeed: (next) => {
      playback?.setSpeed(next);
    },
    at: () => here,
    total: () => steps.length,
    close: () => {
      playback?.cancel();
      graph.setSpotlight(false);
      graph.clearStates();
      log.replaceChildren();
    },
  };
}
