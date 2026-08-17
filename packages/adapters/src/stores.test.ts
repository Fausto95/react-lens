import { describe, it, expect } from "vite-plus/test";
import { createStore as createZustandStore } from "zustand/vanilla";
import { legacy_createStore as createReduxStore } from "redux";
import { QueryClient, dehydrate, hydrate } from "@tanstack/query-core";
import { zustandAdapter } from "./zustand.js";
import { reduxAdapter, withTimeTravel } from "./redux.js";
import { queryAdapter } from "./query.js";

interface CartState {
  count: number;
  add: () => void;
}

describe("zustandAdapter", () => {
  const makeCart = () =>
    createZustandStore<CartState>((set) => ({
      count: 0,
      add: () => set((s) => ({ count: s.count + 1 })),
    }));

  it("restores a snapshot taken earlier", () => {
    const store = makeCart();
    const a = zustandAdapter(store, { id: "cart" });
    const snapshot = a.getSnapshot();
    store.getState().add();
    store.getState().add();
    expect(store.getState().count).toBe(2);

    a.applySnapshot(snapshot);
    expect(store.getState().count).toBe(0);
  });

  it("replaces rather than merges, so keys added after the snapshot are dropped", () => {
    // A merge would leave state the user never had at that point in time —
    // the whole promise of the playhead is that it shows the past exactly.
    const store = createZustandStore<Record<string, unknown>>(() => ({ a: 1 }));
    const a = zustandAdapter(store, { id: "flags" });
    const snapshot = a.getSnapshot();
    store.setState({ b: 2 });
    expect(store.getState()).toEqual({ a: 1, b: 2 });

    a.applySnapshot(snapshot);
    expect(store.getState()).toEqual({ a: 1 });
  });

  it("keeps actions callable after a restore", () => {
    // Actions live in the state object, so a replacing restore must carry them
    // back too — otherwise the rewound app is dead on the first click.
    const store = makeCart();
    const a = zustandAdapter(store, { id: "cart" });
    const snapshot = a.getSnapshot();
    store.getState().add();
    a.applySnapshot(snapshot);
    store.getState().add();
    expect(store.getState().count).toBe(1);
  });

  it("notifies subscribers so useSyncExternalStore re-renders", () => {
    const store = makeCart();
    const a = zustandAdapter(store, { id: "cart" });
    const snapshot = a.getSnapshot();
    store.getState().add();
    let notified = 0;
    store.subscribe(() => notified++);
    a.applySnapshot(snapshot);
    expect(notified).toBe(1);
  });

  it('defaults the id to "zustand"', () => {
    expect(zustandAdapter(makeCart()).id).toBe("zustand");
  });
});

describe("reduxAdapter", () => {
  interface State {
    count: number;
  }
  const reducer = (state: State = { count: 0 }, action: { type: string }): State =>
    action.type === "inc" ? { count: state.count + 1 } : state;

  it("restores through the hydrate action added by withTimeTravel", () => {
    const store = createReduxStore(withTimeTravel(reducer));
    const a = reduxAdapter(store, { id: "app" });
    const snapshot = a.getSnapshot();
    store.dispatch({ type: "inc" });
    store.dispatch({ type: "inc" });
    expect(store.getState().count).toBe(2);

    a.applySnapshot(snapshot);
    expect(store.getState().count).toBe(0);
  });

  it("withTimeTravel leaves every other action to the wrapped reducer", () => {
    const store = createReduxStore(withTimeTravel(reducer));
    store.dispatch({ type: "inc" });
    expect(store.getState()).toEqual({ count: 1 });
  });

  it("withTimeTravel preserves the wrapped reducer's initial state", () => {
    const store = createReduxStore(withTimeTravel(reducer));
    expect(store.getState()).toEqual({ count: 0 });
  });

  it("honours a custom action type on both sides", () => {
    const store = createReduxStore(withTimeTravel(reducer, "app/REWIND"));
    const a = reduxAdapter(store, { actionType: "app/REWIND" });
    const snapshot = a.getSnapshot();
    store.dispatch({ type: "inc" });
    a.applySnapshot(snapshot);
    expect(store.getState().count).toBe(0);
  });

  it("throws when the reducer was never wrapped, instead of silently doing nothing", () => {
    // Without withTimeTravel the hydrate action falls through unchanged, and a
    // playhead that quietly does nothing is worse than a loud failure.
    const store = createReduxStore(reducer);
    const a = reduxAdapter(store);
    const snapshot = a.getSnapshot();
    store.dispatch({ type: "inc" });
    expect(() => a.applySnapshot(snapshot)).toThrow(/withTimeTravel/);
  });
});

describe("queryAdapter", () => {
  function makeClient() {
    return new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  }

  it("restores cached query data from a dehydrated snapshot", async () => {
    const queryClient = makeClient();
    await queryClient.fetchQuery({ queryKey: ["user"], queryFn: async () => "ada" });
    const a = queryAdapter({ queryClient, dehydrate, hydrate });
    const snapshot = a.getSnapshot();

    queryClient.setQueryData(["user"], "grace");
    expect(queryClient.getQueryData(["user"])).toBe("grace");

    a.applySnapshot(snapshot);
    expect(queryClient.getQueryData(["user"])).toBe("ada");
  });

  it("drops queries created after the snapshot", async () => {
    const queryClient = makeClient();
    await queryClient.fetchQuery({ queryKey: ["user"], queryFn: async () => "ada" });
    const a = queryAdapter({ queryClient, dehydrate, hydrate });
    const snapshot = a.getSnapshot();
    queryClient.setQueryData(["later"], 1);

    a.applySnapshot(snapshot);
    expect(queryClient.getQueryData(["later"])).toBeUndefined();
    expect(queryClient.getQueryData(["user"])).toBe("ada");
  });

  it("merge mode cannot rewind a query the app has since updated", async () => {
    // Why clearing is the default: hydrate keeps whichever copy is newer, so
    // merging leaves the live value in place and the playhead lies.
    const queryClient = makeClient();
    await queryClient.fetchQuery({ queryKey: ["user"], queryFn: async () => "ada" });
    const a = queryAdapter({ queryClient, dehydrate, hydrate, mode: "merge" });
    const snapshot = a.getSnapshot();
    queryClient.setQueryData(["user"], "grace");
    queryClient.setQueryData(["later"], 1);

    a.applySnapshot(snapshot);
    expect(queryClient.getQueryData(["user"])).toBe("grace");
    expect(queryClient.getQueryData(["later"])).toBe(1);
  });

  it('defaults the id to "query"', () => {
    expect(queryAdapter({ queryClient: makeClient(), dehydrate, hydrate }).id).toBe("query");
  });
});
