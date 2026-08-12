import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createFiberBridge, type FiberBridge } from "@reactlens/fiber";
import { createSerializer } from "@reactlens/serializer";
import { createInstrumentation } from "./instrumentation.js";
import type { ComponentId, EventsBatchMessage } from "@reactlens/protocol";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Frame = EventsBatchMessage["payload"];

let sharedBridge: FiberBridge | undefined;
async function react() {
  if (!sharedBridge) {
    sharedBridge = createFiberBridge(globalThis);
    sharedBridge.install();
  }
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  return { React, createRoot, act: React.act, bridge: sharedBridge };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("instance descriptions are sent once", () => {
  beforeEach(() => {
    document.body.innerHTML = "<div id='root'></div>";
  });

  it("does not repeat a component's instance on every frame it renders in", async () => {
    // Every rendered component's full instance record used to ride along in
    // every frame. On a large app that is the bulk of the bytes crossing the
    // structured-clone boundary, for data the panel already has and keeps
    // forever — and it is paid again on every commit.
    const frames: Frame[] = [];
    const { React, createRoot, act, bridge } = await react();
    const inst = createInstrumentation({ fiber: bridge, serializer: createSerializer() });
    inst.start({
      captureDOM: false,
      interactionWindowMs: 200,
      streamSnapshots: false,
      onFrame: (f) => frames.push(f),
    });

    let bump: (n: number) => void = () => {};
    function Counter() {
      const [n, set] = React.useState(0);
      bump = set;
      return React.createElement("output", null, `n:${n}`);
    }
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(React.createElement(Counter));
    });
    await flush();

    const mounted = frames.flatMap((f) => f.instances.map((i) => i.id));
    expect(new Set(mounted).size).toBe(mounted.length);
    frames.length = 0;

    for (let n = 1; n <= 5; n++) {
      await act(async () => {
        bump(n);
      });
      await flush();
    }

    // Five more renders of a component the panel already knows about.
    expect(frames.flatMap((f) => f.events)).not.toHaveLength(0);
    expect(frames.flatMap((f) => f.instances)).toEqual([]);
    inst.stop();
  });

  it("re-announces every instance after a restart", async () => {
    // A fresh `start` means a fresh consumer (the panel reconnected to a page
    // that never stopped capturing), so nothing may be assumed already sent.
    const frames: Frame[] = [];
    const { React, createRoot, act, bridge } = await react();
    const inst = createInstrumentation({ fiber: bridge, serializer: createSerializer() });
    const config = {
      captureDOM: false,
      interactionWindowMs: 200,
      streamSnapshots: false,
      onFrame: (f: Frame) => frames.push(f),
    };
    inst.start(config);

    let bump: (n: number) => void = () => {};
    function Widget() {
      const [n, set] = React.useState(0);
      bump = set;
      return React.createElement("output", null, `w:${n}`);
    }
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(React.createElement(Widget));
    });
    await flush();
    const firstIds = frames.flatMap((f) => f.instances.map((i) => i.id));
    expect(firstIds.length).toBeGreaterThan(0);

    inst.stop();
    frames.length = 0;
    inst.start(config);
    await act(async () => {
      bump(1);
    });
    await flush();

    const announced = new Set<ComponentId>(frames.flatMap((f) => f.instances.map((i) => i.id)));
    expect(announced.size).toBeGreaterThan(0);
    inst.stop();
  });
});
