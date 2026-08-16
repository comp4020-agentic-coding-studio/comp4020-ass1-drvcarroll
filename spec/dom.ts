// jsdom has no matchMedia, and the page picks its layout from one. This is a
// gap in the test environment rather than anything about the page, so it is
// stubbed here rather than worked around in the code.

export function useViewport(width: number): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => {
      const limit = /(\d+)px/.exec(query);
      const matches =
        query.includes("max-width") && limit !== null
          ? width <= Number(limit[1])
          : false;
      return {
        matches,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      };
    },
  });
}
