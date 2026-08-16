// The scroll runway before the picture: four lines, two beats, revealed by
// how far the visitor has scrolled through .intro rather than by a timer.
// Only opacity is scroll-linked - the text is real DOM in reading order the
// whole time, so it needs no separate accessible mirror.

// Each line's visible span as a fraction of .intro's own scroll progress:
// fades in over [a, b], holds, fades out over [c, d].
interface Span {
  a: number;
  b: number;
  c: number;
  d: number;
}

const SPANS: readonly Span[] = [
  { a: 0, b: 0.08, c: 0.4, d: 0.46 }, // "Modern codebases are massive."
  { a: 0.16, b: 0.24, c: 0.4, d: 0.46 }, // "...single engineer."
  { a: 0.54, b: 0.62, c: 0.94, d: 1 }, // "Collaborative programming..."
  { a: 0.7, b: 0.78, c: 0.94, d: 1 }, // "This is how..."
];

function opacityAt(p: number, { a, b, c, d }: Span): number {
  if (p < a || p > d) return 0;
  if (p < b) return (p - a) / (b - a);
  if (p <= c) return 1;
  return 1 - (p - c) / (d - c);
}

export function initIntro(): void {
  const section = document.querySelector("[data-intro]");
  const lines = document.querySelectorAll<HTMLElement>("[data-line]");
  if (!(section instanceof HTMLElement) || lines.length !== SPANS.length) {
    return;
  }

  // Switches on the sticky runway and the scroll-linked opacity together, so
  // without script the same four lines are ordinary readable prose.
  section.dataset["live"] = "true";

  let queued = false;

  const paint = (): void => {
    queued = false;
    const rect = section.getBoundingClientRect();
    const run = rect.height - window.innerHeight;
    const p = run <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / run));
    lines.forEach((line, i) => {
      const span = SPANS[i];
      if (span === undefined) return;
      line.style.opacity = String(opacityAt(p, span));
    });
  };

  const request = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(paint);
  };

  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", request);
  paint();
}
