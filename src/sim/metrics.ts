// Turning a stream of queries into numbers a person can read. Everything here
// is a pure function of simulated time, never of frame rate — a readout that
// moved when the browser got busy would be measuring the browser.

// Rates are recomputed on fixed simulated-time boundaries. Quarter-second
// windows are short enough to feel live and long enough not to flicker.
export const WINDOW = 0.25;

// Smoothing constant, in seconds. Two seconds settles quickly enough that a
// knob feels connected, slowly enough that the number is readable.
export const TAU = 2;

// Exponentially weighted mean. Framed in dt and tau rather than a raw alpha
// so a change of window size cannot silently change the smoothing.
export function decay(
  previous: number,
  next: number,
  dt: number = WINDOW,
  tau: number = TAU,
): number {
  const alpha = 1 - Math.exp(-dt / tau);
  return previous + (next - previous) * alpha;
}

// A ring buffer, because a run is unbounded and only the recent shape of the
// latency distribution is worth anything.
export interface Samples {
  values: number[];
  next: number;
  size: number;
}

export const SAMPLE_LIMIT = 512;

export function createSamples(limit: number = SAMPLE_LIMIT): Samples {
  return { values: Array.from({ length: limit }, () => 0), next: 0, size: 0 };
}

export function sample(buffer: Samples, value: number): void {
  buffer.values[buffer.next] = value;
  buffer.next = (buffer.next + 1) % buffer.values.length;
  buffer.size = Math.min(buffer.size + 1, buffer.values.length);
}

// Nearest-rank, on a copy: the buffer's order is its age, and sorting it in
// place would quietly destroy that.
export function quantile(buffer: Samples, p: number): number {
  if (buffer.size === 0) return 0;
  const live = buffer.values.slice(0, buffer.size).sort((a, b) => a - b);
  const rank = Math.ceil(clampUnit(p) * live.length) - 1;
  return live[Math.max(0, rank)] ?? 0;
}

const clampUnit = (p: number): number => Math.min(1, Math.max(0, p));
