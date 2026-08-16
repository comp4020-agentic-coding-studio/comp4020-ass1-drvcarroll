// Motion is the answer to "where did my code go", so it is not decoration.
// It is also the first thing to drop for a visitor who has asked for less of
// it, which is why every duration comes from here.

export const INSIDE_MS = 250; // a move within the laptop
export const NETWORK_MS = 620; // across the gap: a journey, not a step
export const OPEN_MS = 250; // an entity unfolding

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The end state is the truth; the travel is the explanation. Asked for reduced
// motion, we keep the truth and drop the explanation.
export function durationFor(kind: "inside" | "network" | "open"): number {
  if (prefersReducedMotion()) return 0;
  if (kind === "network") return NETWORK_MS;
  if (kind === "open") return OPEN_MS;
  return INSIDE_MS;
}
