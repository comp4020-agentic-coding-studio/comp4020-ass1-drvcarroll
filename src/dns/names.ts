// Name arithmetic, shared by the resolver and its cache. Both have to agree
// on what "inside a zone" means or a cached delegation would be used for a
// name it does not actually cover.

// Names are fully qualified internally: "www.anu.edu.au." with the root dot.
export function fqdn(name: string): string {
  return name.endsWith(".") ? name : `${name}.`;
}

export function labelCount(name: string): number {
  return name === "." ? 0 : fqdn(name).split(".").filter(Boolean).length;
}

// "anu.edu.au." is within "au." and within "."; nothing is within itself.
// The match is on whole labels — "fooau." is not inside "au.".
export function isWithin(name: string, origin: string): boolean {
  if (name === origin) return false;
  if (origin === ".") return true;
  return name.endsWith(`.${origin}`);
}

// The deepest of a set of enclosing names — the most specific thing known
// about where a name lives.
export function deepest(names: string[]): string | undefined {
  return names.reduce<string | undefined>(
    (best, name) =>
      best === undefined || labelCount(name) > labelCount(best) ? name : best,
    undefined,
  );
}
