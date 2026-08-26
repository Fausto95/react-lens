import { useSyncExternalStore } from "react";

/**
 * Tiny in-house store: a mutable snapshot plus `useSyncExternalStore`.
 * Same shape the React Lens adapter needs — get, set, subscribe.
 */
export type ExternalStore<T> = {
  getSnapshot: () => T;
  setState: (next: T | ((prev: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
  useStore: {
    (): T;
    <S>(selector: (state: T) => S): S;
  };
};

export function createExternalStore<T>(initial: T): ExternalStore<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  const getSnapshot = () => state;

  const setState = (next: T | ((prev: T) => T)) => {
    const resolved = typeof next === "function" ? (next as (prev: T) => T)(state) : next;
    if (Object.is(resolved, state)) return;
    state = resolved;
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  function useStore(): T;
  function useStore<S>(selector: (state: T) => S): S;
  function useStore<S>(selector?: (state: T) => S): T | S {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return selector ? selector(snapshot) : snapshot;
  }

  return { getSnapshot, setState, subscribe, useStore };
}
