import { describe, it, expect } from "vite-plus/test";
import { createFiberBridge } from "@reactlens/fiber";
import { createSerializer } from "@reactlens/serializer";
import { createInstrumentation } from "./instrumentation.js";
import { createTimeTravel } from "./time-travel.js";
import type {
  EventsBatchMessage,
  ComponentId,
  RenderId,
  TimeTravelEntry,
} from "@reactlens/protocol";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Frame = EventsBatchMessage["payload"];

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Renders of a named component, oldest→newest, from collected frames. */
function rendersOf(
  frames: Frame[],
  name: string,
): Array<{ componentId: ComponentId; renderId: RenderId }> {
  const ids = new Set(
    frames
      .flatMap((f) => f.instances)
      .filter((i) => i.name === name)
      .map((i) => i.id),
  );
  return frames
    .flatMap((f) => f.events)
    .filter((e) => e.type === "render" && ids.has(e.componentId))
    .map((e) => ({
      componentId: e.componentId!,
      renderId: (e as { renderId: RenderId }).renderId,
    }));
}

// react-dom reads __REACT_DEVTOOLS_GLOBAL_HOOK__ once at module-init, so the
// bridge must be installed before the first react-dom import and shared
// across tests (same constraint as integration.test.ts).
let sharedBridge: ReturnType<typeof createFiberBridge> | undefined;

async function setup() {
  document.body.innerHTML = "<div id='root'></div>";
  if (!sharedBridge) {
    sharedBridge = createFiberBridge(globalThis);
    sharedBridge.install();
  }
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const frames: Frame[] = [];
  const inst = createInstrumentation({
    fiber: sharedBridge,
    serializer: createSerializer(),
  });
  inst.start({ captureDOM: false, interactionWindowMs: 200, onFrame: (f) => frames.push(f) });
  return { React, createRoot, frames, inst };
}

describe("time travel — real state rewind", () => {
  it("rewinds a useState component's DOM, suppresses events, and returns live", async () => {
    const { React, createRoot, frames, inst } = await setup();

    let setCount: (n: number) => void;
    function Counter() {
      const [count, set] = React.useState(0);
      setCount = set;
      return React.createElement("output", null, `count:${count}`);
    }

    // The test environment can produce more than one commit per act, so track
    // the last render index seen at each known DOM state instead of assuming
    // one render per update.
    const root = createRoot(document.getElementById("root")!);
    const lastRenderAt: Record<number, { componentId: ComponentId; renderId: RenderId }> = {};
    await React.act(async () => {
      root.render(React.createElement(Counter));
    });
    await flush();
    lastRenderAt[0] = rendersOf(frames, "Counter").at(-1)!;
    for (const n of [1, 2, 3]) {
      await React.act(async () => setCount!(n));
      await flush();
      lastRenderAt[n] = rendersOf(frames, "Counter").at(-1)!;
    }
    expect(document.querySelector("output")!.textContent).toBe("count:3");
    expect(rendersOf(frames, "Counter").length).toBeGreaterThanOrEqual(4);
    expect(inst.timeTravel.supported()).toBe(true);

    // Rewind to the very first render (count: 0).
    const eventsBefore = frames.flatMap((f) => f.events).length;
    let result!: ReturnType<typeof inst.timeTravel.apply>;
    await React.act(async () => {
      result = inst.timeTravel.apply([lastRenderAt[0]!]);
    });
    expect(result).toMatchObject({ applied: 1, failed: 0, supported: true });
    expect(document.querySelector("output")!.textContent).toBe("count:0");

    // The rewind commit must not leak into the event log.
    await flush();
    expect(frames.flatMap((f) => f.events).length).toBe(eventsBefore);
    expect(inst.timeTravel.isActive()).toBe(true);

    // Scrub forward to an intermediate render.
    await React.act(async () => {
      inst.timeTravel.apply([lastRenderAt[2]!]);
    });
    expect(document.querySelector("output")!.textContent).toBe("count:2");

    // Go live: baseline (count:3) restored, recording resumes.
    await React.act(async () => {
      inst.timeTravel.goLive();
    });
    expect(document.querySelector("output")!.textContent).toBe("count:3");
    await flush(); // active flips off a macrotask later
    expect(inst.timeTravel.isActive()).toBe(false);

    const countBefore = rendersOf(frames, "Counter").length;
    await React.act(async () => setCount!(7));
    await flush();
    expect(document.querySelector("output")!.textContent).toBe("count:7");
    expect(rendersOf(frames, "Counter").length).toBeGreaterThanOrEqual(countBefore + 1);

    inst.stop();
  });

  it("rewinds useReducer state", async () => {
    const { React, createRoot, frames, inst } = await setup();

    let dispatch: (a: { type: "add" }) => void;
    function Cart() {
      const [items, d] = React.useReducer(
        (s: number, a: { type: "add" }) => (a.type === "add" ? s + 1 : s),
        0,
      );
      dispatch = d;
      return React.createElement("output", null, `items:${items}`);
    }

    const root = createRoot(document.getElementById("root")!);
    await React.act(async () => {
      root.render(React.createElement(Cart));
    });
    await React.act(async () => dispatch!({ type: "add" }));
    await flush();
    const atOneItem = rendersOf(frames, "Cart").at(-1)!;
    await React.act(async () => dispatch!({ type: "add" }));
    await flush();
    expect(document.querySelector("output")!.textContent).toBe("items:2");

    await React.act(async () => {
      inst.timeTravel.apply([atOneItem]);
    });
    expect(document.querySelector("output")!.textContent).toBe("items:1");

    // Dispatching after a rewind computes from the overridden state.
    await React.act(async () => {
      inst.timeTravel.goLive();
    });
    expect(document.querySelector("output")!.textContent).toBe("items:2");
    inst.stop();
  });

  it("rewinds class component state", async () => {
    const { React, createRoot, frames, inst } = await setup();

    let bump: () => void;
    class Legacy extends React.Component<Record<string, never>, { n: number }> {
      override state = { n: 0 };
      override render() {
        bump = () => this.setState({ n: this.state.n + 1 });
        return React.createElement("output", null, `n:${this.state.n}`);
      }
    }

    const root = createRoot(document.getElementById("root")!);
    await React.act(async () => {
      root.render(React.createElement(Legacy));
    });
    await React.act(async () => bump!());
    await flush();
    expect(document.querySelector("output")!.textContent).toBe("n:1");

    const renders = rendersOf(frames, "Legacy");
    await React.act(async () => {
      inst.timeTravel.apply([renders[0]!]);
    });
    expect(document.querySelector("output")!.textContent).toBe("n:0");

    await React.act(async () => {
      inst.timeTravel.goLive();
    });
    expect(document.querySelector("output")!.textContent).toBe("n:1");
    inst.stop();
  });
});

/** Minimal fiber bridge double: one useState-like hook per component. */
function makeFakeFiber(over: Partial<Record<string, unknown>> = {}) {
  return {
    canEditValues: () => true,
    hasFiber: () => true,
    setHookState: () => true,
    setClassState: () => true,
    captureLiveState: () => ({ hooks: [{ index: 0, value: 0 }] }),
    ...over,
  };
}

const entry = (r: number, c = 1): TimeTravelEntry => ({
  componentId: c as ComponentId,
  renderId: r as RenderId,
});

/** A fiber whose single state hook holds `value` (shape matches the fake bridge). */
const hookFiber = (value: unknown) =>
  ({ tag: 0, memoizedState: { memoizedState: value, queue: {}, next: null } }) as never;

describe("time travel controller — history bounds", () => {
  it("counts evicted or unknown renders as failed", () => {
    const tt = createTimeTravel({ fiber: makeFakeFiber() as never, rendersPerComponent: 2 });
    tt.capture(1 as RenderId, 1 as ComponentId, hookFiber(1));
    tt.capture(2 as RenderId, 1 as ComponentId, hookFiber(2));
    tt.capture(3 as RenderId, 1 as ComponentId, hookFiber(3)); // evicts renderId 1

    expect(tt.apply([entry(1)])).toMatchObject({ applied: 0, failed: 1 });
    expect(tt.apply([entry(2)])).toMatchObject({ applied: 1, failed: 0 });
    expect(tt.apply([entry(99)])).toMatchObject({ applied: 0, failed: 1 });
  });

  it("a chatty component cannot evict another component's history", () => {
    const tt = createTimeTravel({ fiber: makeFakeFiber() as never, rendersPerComponent: 2 });
    tt.capture(1 as RenderId, 1 as ComponentId, hookFiber(0));
    // Component 2 renders far more often than component 1's retention cap.
    for (let r = 10; r < 30; r++) tt.capture(r as RenderId, 2 as ComponentId, hookFiber(r));
    expect(tt.apply([entry(1, 1)])).toMatchObject({ applied: 1, failed: 0 });
  });

  it("evicts whole components least-recently-captured past maxComponents", () => {
    const tt = createTimeTravel({
      fiber: makeFakeFiber() as never,
      rendersPerComponent: 5,
      maxComponents: 2,
    });
    tt.capture(1 as RenderId, 1 as ComponentId, hookFiber(0));
    tt.capture(2 as RenderId, 2 as ComponentId, hookFiber(0));
    tt.capture(3 as RenderId, 3 as ComponentId, hookFiber(0)); // evicts component 1
    expect(tt.apply([entry(1, 1)])).toMatchObject({ applied: 0, failed: 1 });
    expect(tt.apply([entry(2, 2)])).toMatchObject({ applied: 1, failed: 0 });
    expect(tt.apply([entry(3, 3)])).toMatchObject({ applied: 1, failed: 0 });
  });

  it("re-capturing keeps a component alive in the LRU order", () => {
    const tt = createTimeTravel({
      fiber: makeFakeFiber() as never,
      rendersPerComponent: 5,
      maxComponents: 2,
    });
    tt.capture(1 as RenderId, 1 as ComponentId, hookFiber(0));
    tt.capture(2 as RenderId, 2 as ComponentId, hookFiber(0));
    tt.capture(3 as RenderId, 1 as ComponentId, hookFiber(1)); // refresh component 1
    tt.capture(4 as RenderId, 3 as ComponentId, hookFiber(0)); // evicts component 2
    expect(tt.apply([entry(1, 1)])).toMatchObject({ applied: 1, failed: 0 });
    expect(tt.apply([entry(2, 2)])).toMatchObject({ applied: 0, failed: 1 });
  });
});

describe("time travel controller — failure reasons", () => {
  it("reports no-history for unknown or evicted renders", () => {
    const tt = createTimeTravel({ fiber: makeFakeFiber() as never });
    const result = tt.apply([entry(99, 7)]);
    expect(result.failures).toEqual([
      { componentId: 7 as ComponentId, renderId: 99 as RenderId, reason: "no-history" },
    ]);
  });

  it("reports no-fiber when the component is no longer mounted", () => {
    const tt = createTimeTravel({ fiber: makeFakeFiber({ hasFiber: () => false }) as never });
    tt.capture(1 as RenderId, 1 as ComponentId, hookFiber(0));
    const result = tt.apply([entry(1, 1)]);
    expect(result.failures).toEqual([
      { componentId: 1 as ComponentId, renderId: 1 as RenderId, reason: "no-fiber" },
    ]);
  });

  it("reports shape-mismatch when the hook list changed since capture", () => {
    const tt = createTimeTravel({
      fiber: makeFakeFiber({
        captureLiveState: () => ({
          hooks: [
            { index: 0, value: 0 },
            { index: 1, value: 0 },
          ],
        }),
      }) as never,
    });
    tt.capture(1 as RenderId, 1 as ComponentId, hookFiber(0));
    const result = tt.apply([entry(1, 1)]);
    expect(result.failures).toEqual([
      { componentId: 1 as ComponentId, renderId: 1 as RenderId, reason: "shape-mismatch" },
    ]);
  });

  it("reports write-failed when the renderer refuses the write", () => {
    const tt = createTimeTravel({ fiber: makeFakeFiber({ setHookState: () => false }) as never });
    tt.capture(1 as RenderId, 1 as ComponentId, hookFiber(0));
    const result = tt.apply([entry(1, 1)]);
    expect(result.failures).toEqual([
      { componentId: 1 as ComponentId, renderId: 1 as RenderId, reason: "write-failed" },
    ]);
  });

  it("stateless components are silent no-ops, not failures", () => {
    const tt = createTimeTravel({ fiber: makeFakeFiber() as never });
    tt.capture(1 as RenderId, 1 as ComponentId, { tag: 0, memoizedState: null } as never);
    const result = tt.apply([entry(1, 1)]);
    expect(result).toMatchObject({ applied: 0, failed: 0 });
    expect(result.failures).toEqual([]);
  });

  it("successful applies report an empty failures list", () => {
    const tt = createTimeTravel({ fiber: makeFakeFiber() as never });
    tt.capture(1 as RenderId, 1 as ComponentId, hookFiber(0));
    const result = tt.apply([entry(1, 1)]);
    expect(result).toMatchObject({ applied: 1, failed: 0 });
    expect(result.failures).toEqual([]);
  });
});

describe("time travel controller — external-store adapters", () => {
  function makeStoreFixture(initial: number, id = "demo") {
    let value = initial;
    return {
      adapter: {
        id,
        getSnapshot: () => value,
        applySnapshot(s: unknown) {
          value = s as number;
        },
      },
      set(n: number) {
        value = n;
      },
      get: () => value,
    };
  }

  it("restores a registered store to its snapshot at or before t and back on goLive", () => {
    const tt = createTimeTravel({ fiber: makeFakeFiber() as never });
    const fx = makeStoreFixture(0);
    tt.registerStore(fx.adapter);
    tt.captureStores(100); // value 0
    fx.set(1);
    tt.captureStores(200); // value 1
    fx.set(2); // live value, never captured

    const mid = tt.apply([], 150);
    expect(fx.get()).toBe(0);
    expect(mid).toMatchObject({ storesApplied: 1, storeFailures: [] });

    tt.apply([], 250);
    expect(fx.get()).toBe(1);

    tt.goLive();
    expect(fx.get()).toBe(2);
  });

  it("counts stores separately from components", () => {
    const tt = createTimeTravel({ fiber: makeFakeFiber() as never });
    tt.capture(1 as RenderId, 1 as ComponentId, hookFiber(0));
    const fx = makeStoreFixture(0);
    tt.registerStore(fx.adapter);
    tt.captureStores(100);

    const result = tt.apply([entry(1, 1)], 150);
    // applied/failed describe components only — a store restore must not
    // inflate the panel's "N components restored" count.
    expect(result).toMatchObject({ applied: 1, failed: 0, storesApplied: 1 });
  });

  it("names the store and reason when no snapshot exists at or before t", () => {
    const tt = createTimeTravel({ fiber: makeFakeFiber() as never });
    const fx = makeStoreFixture(7, "cart");
    tt.registerStore(fx.adapter);
    tt.captureStores(500);
    const result = tt.apply([], 100);
    expect(result).toMatchObject({ applied: 0, failed: 0, storesApplied: 0 });
    expect(result.storeFailures).toEqual([{ storeId: "cart", reason: "no-snapshot" }]);
    expect(fx.get()).toBe(7); // untouched
  });

  it("unregistering stops capture and restoration", () => {
    const tt = createTimeTravel({ fiber: makeFakeFiber() as never });
    const fx = makeStoreFixture(0);
    const off = tt.registerStore(fx.adapter);
    tt.captureStores(100);
    off();
    fx.set(5);
    tt.apply([], 150);
    expect(fx.get()).toBe(5);
  });

  it("a stale unregister does not tear down a re-registration of the same id", () => {
    const tt = createTimeTravel({ fiber: makeFakeFiber() as never });
    const first = makeStoreFixture(0, "cart");
    const off = tt.registerStore(first.adapter);
    // Hot reload: the module re-registers under the same id, then the old
    // effect cleanup runs. It must not unregister the live adapter.
    const second = makeStoreFixture(0, "cart");
    tt.registerStore(second.adapter);
    off();

    tt.captureStores(100);
    second.set(9);
    const result = tt.apply([], 150);
    expect(result).toMatchObject({ storesApplied: 1, storeFailures: [] });
    expect(second.get()).toBe(0);
  });

  it("bounds per-store snapshot history", () => {
    const tt = createTimeTravel({ fiber: makeFakeFiber() as never, snapshotsPerStore: 2 });
    const fx = makeStoreFixture(0);
    tt.registerStore(fx.adapter);
    for (const t of [100, 200, 300]) {
      fx.set(t);
      tt.captureStores(t);
    }
    fx.set(999);
    expect(tt.apply([], 150)).toMatchObject({
      storesApplied: 0,
      storeFailures: [{ storeId: "demo", reason: "no-snapshot" }],
    }); // t=100 evicted
    tt.apply([], 250);
    expect(fx.get()).toBe(200);
  });

  it("an unchanged snapshot does not consume retention", () => {
    const tt = createTimeTravel({ fiber: makeFakeFiber() as never, snapshotsPerStore: 2 });
    const fx = makeStoreFixture(1);
    tt.registerStore(fx.adapter);
    tt.captureStores(100);
    // Commits that leave the store untouched must not evict the t=100 entry:
    // the snapshot is reference-identical, so it is not new history.
    tt.captureStores(200);
    tt.captureStores(300);
    fx.set(42);
    expect(tt.apply([], 150)).toMatchObject({ storesApplied: 1, storeFailures: [] });
    expect(fx.get()).toBe(1);
  });

  it("an adapter that throws on apply is named as apply-failed, others still apply", () => {
    const tt = createTimeTravel({ fiber: makeFakeFiber() as never });
    const good = makeStoreFixture(0);
    tt.registerStore(good.adapter);
    tt.registerStore({
      id: "broken",
      getSnapshot: () => 0,
      applySnapshot() {
        throw new Error("nope");
      },
    });
    tt.captureStores(100);
    good.set(9);
    const result = tt.apply([], 150);
    expect(result).toMatchObject({ storesApplied: 1 });
    expect(result.storeFailures).toEqual([{ storeId: "broken", reason: "apply-failed" }]);
    expect(good.get()).toBe(0);
  });

  it("routes adapter errors to onError instead of swallowing them", () => {
    const errors: Array<{ scope: string; message: string }> = [];
    const tt = createTimeTravel({
      fiber: makeFakeFiber() as never,
      onError: (scope, err) => errors.push({ scope, message: (err as Error).message }),
    });
    tt.registerStore({
      id: "broken",
      getSnapshot() {
        throw new Error("snapshot boom");
      },
      applySnapshot() {},
    });
    tt.captureStores(100);
    expect(errors).toEqual([{ scope: "store-snapshot", message: "snapshot boom" }]);
  });

  it("takes the go-live baseline before any component write lands", () => {
    // A component restore can synchronously write to a store (an effect, a
    // subscription). The baseline must be the pre-travel live value, not
    // whatever the component restore left behind.
    const fx = makeStoreFixture(0);
    const tt = createTimeTravel({
      fiber: makeFakeFiber({
        setHookState: () => {
          fx.set(-1); // component restore clobbers the store
          return true;
        },
      }) as never,
    });
    tt.registerStore(fx.adapter);
    tt.captureStores(100);
    fx.set(5); // live value at the moment travel begins
    tt.capture(1 as RenderId, 1 as ComponentId, hookFiber(0));

    tt.apply([entry(1, 1)], 150);
    expect(fx.get()).toBe(0);
    tt.goLive();
    expect(fx.get()).toBe(5);
  });
});
