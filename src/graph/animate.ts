import type { ResolutionStep } from "../dns/types.js";
import type { Graph } from "./render.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// One message in flight, and the pause after it lands. The pause is what
// makes a walk read as discrete messages rather than one continuous slide.
const STEP_MS = 620;
const HOLD_MS = 280;

// Discrete detents, because a continuous slider cannot be aimed and the
// leftmost value has to be exactly zero to mean "manual".
export const SPEEDS = [0, 0.5, 0.75, 1, 1.5, 2, 3];

export const speedLabel = (rate: number): string =>
  rate === 0 ? "Manual — click to advance" : `${String(rate)}× auto`;

export interface Playback {
  next(): void;
  back(): void;
  seek(index: number): void;
  setSpeed(rate: number): void;
  cancel(): void;
}

export interface PlaybackHooks {
  // `furthest` is how far the walk has ever reached, which is what the
  // transcript is allowed to show. `at` is merely where the visitor is
  // looking, so seeking back re-reads without un-revealing.
  onSeek(at: number, furthest: number): void;
  onDone(): void;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The transcript exists in full before a frame is drawn, so every step is
// replayable and seeking backwards is just replaying fewer of them. That is
// why there is no undo here: graph state is derived, never accumulated.
export function playResolution(
  graph: Graph,
  steps: ResolutionStep[],
  hooks: PlaybackHooks,
  speed: number,
): Playback {
  const reduced = prefersReducedMotion();

  let rate = speed;
  let at = -1;
  let furthest = -1;
  let flying = false;
  let startedAt = 0;
  let restedAt = 0;
  let announced = false;
  let cancelled = false;
  let frame = 0;

  const packet = document.createElementNS(SVG_NS, "circle");
  packet.setAttribute("r", "9");
  packet.setAttribute("class", "packet");
  packet.setAttribute("data-flying", "false");
  graph.root.append(packet);

  // Everything a landed step does to the graph. Applied in order from a
  // cleared graph, this reconstructs any point in the walk exactly.
  function land(step: ResolutionStep, index: number): void {
    if (step.zone) graph.setNodeZone(step.to, step.zone);
    graph.say(step.from, step.note, step.kind);
    graph.revealEdge(step.from, step.to);
    graph.markEdge(step.from, step.to, String(index + 1));
    graph.setNodeState(step.to, step.kind);
  }

  function applyThrough(index: number): void {
    graph.clearStates();
    for (let i = 0; i <= index; i += 1) {
      const step = steps[i];
      if (step !== undefined) land(step, i);
    }
  }

  function announce(): void {
    if (announced || furthest < steps.length - 1) return;
    announced = true;
    hooks.onDone();
  }

  function goTo(index: number, animate: boolean): void {
    if (steps.length === 0) return;
    at = Math.max(0, Math.min(index, steps.length - 1));
    furthest = Math.max(furthest, at);

    const step = steps[at];
    if (animate && !reduced && step !== undefined) {
      // The graph is rebuilt to the moment *before* this step, so the packet
      // has somewhere to travel from.
      applyThrough(at - 1);
      if (step.zone) graph.setNodeZone(step.to, step.zone);
      // The speaker speaks before the packet leaves, so the box is on screen
      // for the whole time the message is in flight.
      graph.say(step.from, step.note, step.kind);
      graph.revealEdge(step.from, step.to);
      graph.markEdge(step.from, step.to, String(at + 1));
      graph.setNodeState(step.from, "active");
      packet.setAttribute("data-kind", step.kind);
      packet.setAttribute("data-flying", "true");
      flying = true;
      startedAt = 0;
    } else {
      applyThrough(at);
      packet.setAttribute("data-flying", "false");
      flying = false;
      restedAt = performance.now();
    }

    hooks.onSeek(at, furthest);
    if (!flying) announce();
  }

  function arrive(step: ResolutionStep, now: number): void {
    graph.setNodeState(step.to, step.kind);
    packet.setAttribute("data-flying", "false");
    flying = false;
    restedAt = now;
    announce();
  }

  function tick(now: number): void {
    if (cancelled) return;
    frame = requestAnimationFrame(tick);

    const step = steps[at];

    if (flying && step !== undefined) {
      if (startedAt === 0) startedAt = now;
      // Manual mode still animates the flight at 1x — the slider governs
      // pacing between messages, not whether a packet is visible.
      const progress = Math.min((now - startedAt) / (STEP_MS / (rate || 1)), 1);
      const from = graph.nodeAt(step.from);
      const to = graph.nodeAt(step.to);
      packet.setAttribute("cx", String(from.x + (to.x - from.x) * progress));
      packet.setAttribute("cy", String(from.y + (to.y - from.y) * progress));
      if (progress >= 1) arrive(step, now);
      return;
    }

    if (rate > 0 && at < steps.length - 1 && now - restedAt >= HOLD_MS / rate) {
      goTo(at + 1, true);
    }
  }

  frame = requestAnimationFrame(tick);
  goTo(0, true);

  return {
    // An impatient click on a message still in flight lands it rather than
    // skipping it: the visitor asked to move on, not to miss one.
    next(): void {
      const step = steps[at];
      if (flying && step !== undefined) arrive(step, performance.now());
      else goTo(at + 1, true);
    },
    back(): void {
      goTo(at - 1, false);
    },
    seek(index: number): void {
      goTo(index, false);
    },
    setSpeed(next: number): void {
      rate = next;
      restedAt = performance.now();
    },
    cancel(): void {
      cancelled = true;
      cancelAnimationFrame(frame);
      packet.remove();
    },
  };
}
