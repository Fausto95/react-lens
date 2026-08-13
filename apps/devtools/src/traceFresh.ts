/**
 * Compiler-visible freshness for the main-thread TraceStore cache.
 *
 * The store mutates in place: its identity never changes. Passing the version
 * from `useTraceVersion` / `traceVersionAtom` into these helpers makes that
 * counter part of the read so the React Compiler cannot cache forever on the
 * stable store reference.
 *
 * Replaces the old `useDerived` hook: call sites either read through
 * {@link readFresh} or key {@link derivationCache} on the version themselves.
 */
export function readFresh<T>(version: number, read: () => T): T {
  // `version` is deliberately unused: its presence in the argument list is the
  // dependency. Referencing it keeps that intent legible to both readers.
  void version;
  return read();
}

export interface DerivationCache<T> {
  read(keys: readonly unknown[], compute: () => T): T;
}

/** Identity-keyed cache for expensive store derivations (timeline, tree). */
export function derivationCache<T>(): DerivationCache<T> {
  let held: { keys: readonly unknown[]; value: T } | null = null;
  return {
    read(keys, compute) {
      if (held && sameKeys(held.keys, keys)) return held.value;
      held = { keys, value: compute() };
      return held.value;
    },
  };
}

/** Identity comparison: a fresh-but-equal object is a real change. */
function sameKeys(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}
