import { useRef } from "react";

/**
 * Memoize a derivation over the trace store, with keys we own.
 *
 * The store mutates in place: its identity never changes, and only the version
 * counter from `useTraceVersion` says the data moved on. A `useMemo` keyed on
 * that version is a lie to the React Compiler — the callback never *reads* the
 * version, and the compiler derives dependencies from reads, so it drops it,
 * caches on the store's stable identity and serves the mount's answer forever.
 * That is what the `"use no memo"` directives were guarding against, at the
 * cost of leaving whole files uncompiled.
 *
 * This says the same thing in a form the compiler cannot misread: the key array
 * genuinely reads the version, and the comparison is ours, so the compiler is
 * free to optimise everything around it.
 *
 * Not reference-stability memoization — it exists because an external mutable
 * store's freshness is invisible to any compiler.
 */
export function useDerived<T>(keys: readonly unknown[], compute: () => T): T {
  const cache = useRef<DerivationCache<T> | null>(null);
  cache.current ??= derivationCache<T>();
  return cache.current.read(keys, compute);
}

/**
 * Read the store now, and make the version part of that read.
 *
 * For the cheap reads scattered through a component body — `store.instance(id)`,
 * `store.snapshot(id)` — which the Compiler would otherwise cache on the
 * store's never-changing identity and serve stale for the rest of the session.
 * Passing the version in means the memoization block depends on it, so it
 * recomputes exactly when the trace moves on.
 *
 * A hook would be wrong here: several of these sit after an early return.
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

/** The cache behind `useDerived`, separated so it is testable without React. */
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
