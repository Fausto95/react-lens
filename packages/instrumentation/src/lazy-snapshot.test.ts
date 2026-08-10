import { describe, it, expect } from "vitest";
import { createFiberBridge } from "@react-lens/fiber";
import { createSerializer } from "@react-lens/serializer";
import { createInstrumentation } from "./instrumentation.js";
import type { EventsBatchMessage, RenderEvent } from "@react-lens/protocol";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Frame = EventsBatchMessage["payload"];
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("two-tier capture: lightweight stream + on-demand snapshots", () => {
  it("streams instances without snapshots, then builds a snapshot on demand", async () => {
    document.body.innerHTML = "<div id='root'></div>";
    // Install the hook before react-dom evaluates, or it never registers.
    const bridge = createFiberBridge(globalThis);
    bridge.install();
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");

    function Badge({ label }: { label: string }) {
      return React.createElement("span", null, label);
    }
    function App() {
      return React.createElement("div", null, React.createElement(Badge, { label: "hi" }));
    }

    const frames: Frame[] = [];
    const inst = createInstrumentation({
      fiber: bridge,
      serializer: createSerializer(),
    });
    inst.start({
      captureDOM: false,
      interactionWindowMs: 200,
      streamSnapshots: false,
      onFrame: (f) => frames.push(f),
    });

    const root = createRoot(document.getElementById("root")!);
    await React.act(async () => {
      root.render(React.createElement(App));
    });
    await flush();

    // The tree streamed (instances + render events) but NO inline snapshots.
    const names = new Set(frames.flatMap((f) => f.instances).map((i) => i.name));
    expect(names.has("App")).toBe(true);
    expect(names.has("Badge")).toBe(true);
    expect(frames.flatMap((f) => f.snapshots)).toHaveLength(0);

    // A snapshot for a specific render is available on demand.
    const badgeEvent = frames
      .flatMap((f) => f.events)
      .filter((e): e is RenderEvent => e.type === "render")
      .find((e) => names.size > 0 && frames.flatMap((f) => f.instances).find((i) => i.id === e.componentId)?.name === "Badge");
    expect(badgeEvent).toBeDefined();

    const snap = inst.snapshot(badgeEvent!.renderId);
    expect(snap).toBeDefined();
    expect(snap!.props.k).toBe("object");

    inst.stop();
  });
});
