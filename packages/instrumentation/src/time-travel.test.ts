import { describe, it, expect } from "vitest";
import { createFiberBridge } from "@react-lens/fiber";
import { createSerializer } from "@react-lens/serializer";
import { createInstrumentation } from "./instrumentation.js";
import { createTimeTravel } from "./time-travel.js";
import type {
  EventsBatchMessage,
  ComponentId,
  RenderId,
  TimeTravelEntry,
} from "@react-lens/protocol";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Frame = EventsBatchMessage["payload"];

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Renders of a named component, oldest→newest, from collected frames. */
function rendersOf(frames: Frame[], name: string): Array<{ componentId: ComponentId; renderId: RenderId }> {
  const ids = new Set(
    frames.flatMap((f) => f.instances).filter((i) => i.name === name).map((i) => i.id),
  );
  return frames
    .flatMap((f) => f.events)
    .filter((e) => e.type === "render" && ids.has(e.componentId))
    .map((e) => ({ componentId: e.componentId!, renderId: (e as { renderId: RenderId }).renderId }));
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
