import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFiberBridge } from "@react-lens/fiber";
import { createSerializer } from "@react-lens/serializer";
import { createInstrumentation } from "@react-lens/instrumentation";
import { TraceStore } from "@react-lens/trace-engine";
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

    // Scrub to just after the count:1 commit.
    await React.act(async () => {
      ctl.onCursor({ t: commitTimes[0]! + 0.1, mode: "historical" }, true);
      flushRaf();
      await flush();
    });
    expect(document.querySelector("output")!.textContent).toBe("count:1");
    const last = statuses.at(-1);
    expect(last).not.toBeNull();
    expect(last!.applied).toBeGreaterThan(0);

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
