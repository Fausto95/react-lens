import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { createFiberBridge } from "@reactlens/fiber";
import { createSerializer } from "@reactlens/serializer";
import { createInstrumentation } from "@reactlens/instrumentation";
import { TraceStore } from "@reactlens/trace-engine";
import { createPanelTimeTravel, type RestoreStatus } from "./timeTravelController.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => new Promise((r) => setTimeout(r, 0));

let rafQueue: FrameRequestCallback[] = [];
function flushRaf(): void {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(0);
}

let sharedBridge: ReturnType<typeof createFiberBridge> | undefined;

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("panel → page time travel (full seam)", () => {
  it("scrubbing the cursor rewinds the real DOM through the controller", async () => {
    document.body.innerHTML = "<div id='root'></div>";
    if (!sharedBridge) {
      sharedBridge = createFiberBridge(globalThis);
      sharedBridge.install();
    }
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");

    // The exact embedded wiring: instrumentation frames → TraceStore.
    const store = new TraceStore();
    const inst = createInstrumentation({ fiber: sharedBridge, serializer: createSerializer() });
    inst.start({ captureDOM: false, interactionWindowMs: 200, onFrame: (f) => store.ingest(f) });

    let setCount: (n: number) => void;
    function Counter() {
      const [count, set] = React.useState(0);
      setCount = set;
      return React.createElement("output", null, `count:${count}`);
    }
    const root = createRoot(document.getElementById("root")!);
    await React.act(async () => {
      root.render(React.createElement(Counter));
    });
    await flush();
    const commitTimes: number[] = [];
    for (const n of [1, 2, 3]) {
      await React.act(async () => setCount!(n));
      await flush();
      commitTimes.push(store.commits().at(-1)!.timestamp);
    }
    expect(document.querySelector("output")!.textContent).toBe("count:3");

    const statuses: Array<RestoreStatus | null> = [];
    const ctl = createPanelTimeTravel(store, inst.timeTravel, (s) => statuses.push(s));

    // Scrub between the count:1 and count:2 commits. Derived from the data
    // rather than a fixed epsilon, so clock granularity can't move the cursor
    // onto the wrong commit — and asserted first, so a future clock change
    // fails here with the timings instead of surfacing as a puzzling
    // "expected count:1" further down.
    const gaps = commitTimes.slice(1).map((t, i) => t - commitTimes[i]!);
    expect(
      gaps.every((g) => g > 0),
      `commits must be distinguishable to scrub between them (times=${JSON.stringify(commitTimes)})`,
    ).toBe(true);
    const cursorT = (commitTimes[0]! + commitTimes[1]!) / 2;
    await React.act(async () => {
      ctl.onCursor({ t: cursorT, mode: "historical" }, true);
      flushRaf();
      await flush();
    });
    const context = `cursor=${cursorT} commits=${JSON.stringify(commitTimes)} gaps=${JSON.stringify(gaps)}`;
    expect(document.querySelector("output")!.textContent, context).toBe("count:1");
    const last = statuses.at(-1);
    expect(last, context).not.toBeNull();
    expect(last!.applied, context).toBeGreaterThan(0);

    // Back to live restores the pre-travel state.
    await React.act(async () => {
      ctl.onCursor({ t: commitTimes[2]!, mode: "live" }, true);
      await flush();
    });
    expect(document.querySelector("output")!.textContent).toBe("count:3");
    expect(statuses.at(-1)).toBeNull();

    ctl.dispose();
    inst.stop();
  });
});

describe("panel → page replay (forward play)", () => {
  it("playing from session start walks the DOM through intermediate states", async () => {
    document.body.innerHTML = "<div id='root'></div>";
    if (!sharedBridge) {
      sharedBridge = createFiberBridge(globalThis);
      sharedBridge.install();
    }
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");

    const store = new TraceStore();
    const inst = createInstrumentation({ fiber: sharedBridge, serializer: createSerializer() });
    inst.start({ captureDOM: false, interactionWindowMs: 200, onFrame: (f) => store.ingest(f) });

    let setCount: (n: number) => void;
    function Counter() {
      const [count, set] = React.useState(0);
      setCount = set;
      return React.createElement("output", null, `count:${count}`);
    }
    const root = createRoot(document.getElementById("root")!);
    await React.act(async () => {
      root.render(React.createElement(Counter));
    });
    await flush();
    for (const n of [1, 2, 3]) {
      await React.act(async () => setCount!(n));
      await flush();
    }
    expect(document.querySelector("output")!.textContent).toBe("count:3");

    const ctl = createPanelTimeTravel(store, inst.timeTravel);
    const commits = store.commits();
    const liveT = commits.at(-1)!.timestamp;

    // Simulate play(): the cursor visits every commit in order, one flush per
    // animation frame, then jumps live. Stepping the commits themselves (rather
    // than sampling arbitrary fractions of the span) means the walk can't skip
    // a state just because two commits landed close together.
    // Seeded with the live value, so the sequence reads "started live, walked
    // every commit, ended live" (the old first sample did this implicitly by
    // scrubbing to a point before the first commit).
    const seen: string[] = [document.querySelector("output")!.textContent!];
    for (const commit of commits) {
      await React.act(async () => {
        ctl.onCursor({ t: commit.timestamp, mode: "historical" }, true);
        flushRaf();
        await flush();
      });
      const text = document.querySelector("output")!.textContent!;
      if (seen.at(-1) !== text) seen.push(text);
    }
    await React.act(async () => {
      ctl.onCursor({ t: liveT, mode: "live" }, true);
      await flush();
    });

    // The replay must pass through the intermediate states, not sit on the
    // final value the whole time.
    expect(seen).toEqual(["count:3", "count:0", "count:1", "count:2", "count:3"]);
    expect(document.querySelector("output")!.textContent).toBe("count:3");

    ctl.dispose();
    inst.stop();
  });
});
