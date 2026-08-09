import type { ResolutionStep } from "../dns/types.js";
import type { Graph } from "./render.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const STEP_MS = 620;

export interface Playback {
  cancel(): void;
}

export interface PlaybackHooks {
  onStep(step: ResolutionStep, index: number): void;
  onDone(): void;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The whole transcript already exists before a frame is drawn, so the
// reduced-motion path is not a second implementation — it is the same steps
// delivered at once.
export function playResolution(
  graph: Graph,
  steps: ResolutionStep[],
  hooks: PlaybackHooks,
): Playback {
  graph.clearStates();

  if (prefersReducedMotion()) {
    steps.forEach((step, index) => {
      hooks.onStep(step, index);
      graph.setNodeState(step.to, step.kind);
    });
    hooks.onDone();
    return { cancel: () => undefined };
  }

  const packet = document.createElementNS(SVG_NS, "circle");
  packet.setAttribute("r", "9");
  packet.setAttribute("class", "packet");
  graph.root.append(packet);

  let frame = 0;
  let index = -1;
  let startedAt = 0;
  let cancelled = false;

  function beginStep(next: number, now: number): void {
    index = next;
    startedAt = now;
    const step = steps[index];
    if (step === undefined) return;
    packet.setAttribute("data-kind", step.kind);
    graph.setNodeState(step.from, "active");
    hooks.onStep(step, index);
  }

  function tick(now: number): void {
    if (cancelled) return;

    if (index < 0) beginStep(0, now);

    const step = steps[index];
    if (step === undefined) {
      packet.remove();
      hooks.onDone();
      return;
    }

    const progress = Math.min((now - startedAt) / STEP_MS, 1);
    const from = graph.nodeAt(step.from);
    const to = graph.nodeAt(step.to);
    packet.setAttribute("cx", String(from.x + (to.x - from.x) * progress));
    packet.setAttribute("cy", String(from.y + (to.y - from.y) * progress));

    if (progress >= 1) {
      graph.setNodeState(step.to, step.kind);
      if (index + 1 >= steps.length) {
        packet.remove();
        hooks.onDone();
        return;
      }
      beginStep(index + 1, now);
    }

    frame = requestAnimationFrame(tick);
  }

  frame = requestAnimationFrame(tick);

  return {
    cancel(): void {
      cancelled = true;
      cancelAnimationFrame(frame);
      packet.remove();
    },
  };
}
