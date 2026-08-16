// The page's entry point. Empty by design until the model underneath it is
// built and asserted: the object model lands headless at step 2, the stores at
// step 3, and nothing is drawn until step 6.

export function start(): void {
  const stage = document.querySelector("[data-graph]");
  if (stage === null) return;
}
