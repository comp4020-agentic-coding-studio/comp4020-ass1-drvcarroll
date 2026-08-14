import { hitRate, percentile, type SimState } from "../sim/engine.js";

// Numbers, formatted. Pure functions of the simulation so the page's claims
// can be asserted without a DOM — and so a readout cannot quietly compute
// something different from what the tests check.

// Query rates the edge shading and the node numbers are banded against.
// Absolute rates rather than a share of the busiest edge: a relative scale
// would repaint everything green the moment the visitor grew the network,
// which is the opposite of what growth is supposed to show.
export const HOT = 4;
export const OVER = 12;

export const band = (rate: number): string =>
  rate > OVER ? "over" : rate > HOT ? "hot" : "ok";

// 0–1, for the shading's own opacity and width.
export const intensity = (rate: number): number => Math.min(1, rate / OVER);

// One decimal below ten, none above: 0.4 q/s and 340 q/s are both readable,
// and 0 q/s has to be distinguishable from "a little".
export function perSecond(rate: number): string {
  if (rate === 0) return "0 q/s";
  if (rate < 10) return `${rate.toFixed(1)} q/s`;
  return `${String(Math.round(rate))} q/s`;
}

export const rateOf = (state: SimState, id: string): number =>
  state.nodes.get(id)?.rate ?? 0;

export const nodeMetric = (state: SimState, id: string): string =>
  perSecond(rateOf(state, id));

// The only prose the page keeps, and the argument in one line: the second
// number is the one holding the hierarchy up, and the last is the price.
export function headline(state: SimState): string {
  const { queries, lied, dropped } = state.totals;
  const memory = Math.round(hitRate(state) * 100);
  const parts = [
    `${queries.toLocaleString()} queries`,
    `${String(memory)}% answered from memory`,
    `p95 ${String(Math.round(percentile(state, 0.95)))} ms`,
  ];
  // Absent rather than zero: a counter reading 0 all day trains people to
  // stop reading it, and these two only matter once they are not zero.
  if (dropped > 0) parts.push(`${dropped.toLocaleString()} dropped`);
  if (lied > 0) parts.push(`${lied.toLocaleString()} served a lie`);
  return parts.join(" · ");
}
