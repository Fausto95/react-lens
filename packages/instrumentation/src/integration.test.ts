import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createFiberBridge, type FiberBridge } from "@reactlens/fiber";
import { createSerializer } from "@reactlens/serializer";
import { createInstrumentation } from "./instrumentation.js";
import type { EventsBatchMessage, RenderEvent } from "@reactlens/protocol";

// Marks this as a valid React test environment for act().
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Frame = EventsBatchMessage["payload"];

/**
 * react-dom reads __REACT_DEVTOOLS_GLOBAL_HOOK__ once at module-init and keeps
 * the reference. So the hook must be installed exactly once, before the first
 * react-dom import, and shared across tests — a single bridge whose per-test
 * instrumentation subscribes/unsubscribes via onCommit.
 */
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

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

function allRenders(frames: Frame[]): RenderEvent[] {
  return frames.flatMap((f) => f.events).filter((e): e is RenderEvent => e.type === "render");
}

function nameOf(frames: Frame[], id: number): string | undefined {
  return frames.flatMap((f) => f.instances).find((i) => i.id === (id as never))?.name;
}

describe("instrumentation + fiber against real React 19", () => {
  beforeEach(() => {
    document.body.innerHTML = "<div id='root'></div>";
  });

  it("captures a mount and resolves the clicked component", async () => {
    const frames: Frame[] = [];
    const { React, createRoot, act, bridge } = await react();
    const inst = createInstrumentation({ fiber: bridge, serializer: createSerializer() });
    inst.start({ captureDOM: true, interactionWindowMs: 200, onFrame: (f) => frames.push(f) });

    function Label({ text }: { text: string }) {
      return React.createElement("span", { className: "label" }, text);
    }
    function App() {
      return React.createElement("div", { id: "app" }, React.createElement(Label, { text: "hi" }));
    }

    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(React.createElement(App));
    });
    await flush();

    const renders = allRenders(frames);
    const names = new Set(renders.map((r) => nameOf(frames, r.componentId as unknown as number)));
    expect(names.has("App")).toBe(true);
    expect(names.has("Label")).toBe(true);

    const span = document.querySelector("span.label")!;
    expect(bridge.resolveComponent(span)?.name).toBe("Label");

    inst.stop();
  });

  it("counts re-renders driven by state and props", async () => {
    const frames: Frame[] = [];
    const { React, createRoot, act, bridge } = await react();
    const inst = createInstrumentation({ fiber: bridge, serializer: createSerializer() });
    inst.start({ captureDOM: true, interactionWindowMs: 200, onFrame: (f) => frames.push(f) });

    let setCount: (n: number) => void = () => {};
    function Child({ count }: { count: number }) {
      return React.createElement("p", { className: "child" }, String(count));
    }
    function Parent() {
      const [count, setC] = React.useState(0);
      setCount = setC;
      return React.createElement("div", null, React.createElement(Child, { count }));
    }

    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(React.createElement(Parent));
    });
    await act(async () => setCount(1));
    await act(async () => setCount(2));
    await flush();

    const renders = allRenders(frames);
    const byName = (name: string) =>
      renders.filter((r) => nameOf(frames, r.componentId as unknown as number) === name);

    expect(byName("Parent").length).toBeGreaterThanOrEqual(3);
    expect(byName("Child").length).toBeGreaterThanOrEqual(3);

    const childUpdate = byName("Child").find((r) =>
      r.reasons.some((reason) => reason.type === "props" && reason.changed.includes("count")),
    );
    expect(childUpdate).toBeDefined();

    inst.stop();
  });

  it("captures hooks, state, ref, memo and context in the snapshot", async () => {
    const frames: Frame[] = [];
    const { React, createRoot, act, bridge } = await react();
    const inst = createInstrumentation({ fiber: bridge, serializer: createSerializer() });
    inst.start({ captureDOM: true, interactionWindowMs: 200, onFrame: (f) => frames.push(f) });

    const Theme = React.createContext("light");

    function Widget() {
      const [count] = React.useState(7);
      const ref = React.useRef(3);
      const doubled = React.useMemo(() => count * 2, [count]);
      const theme = React.useContext(Theme);
      return React.createElement(
        "div",
        { className: "widget" },
        `${theme}:${count}:${doubled}:${ref.current}`,
      );
    }
    function Root() {
      return React.createElement(Theme.Provider, { value: "dark" }, React.createElement(Widget));
    }

    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(React.createElement(Root));
    });
    await flush();

    // Find the latest Widget snapshot.
    const widgetId = frames.flatMap((f) => f.instances).find((i) => i.name === "Widget")?.id;
    expect(widgetId).toBeDefined();
    const snap = frames
      .flatMap((f) => f.snapshots)
      .filter((s) => s.componentId === widgetId)
      .at(-1);
    expect(snap).toBeDefined();

    const hooks = snap!.hooks ?? [];
    const stateHook = hooks.find((h) => h.kind === "state");
    expect(stateHook?.value).toEqual({ k: "primitive", type: "number", value: 7 });

    const refHook = hooks.find((h) => h.kind === "ref");
    expect(refHook?.value).toEqual({ k: "primitive", type: "number", value: 3 });

    const memoHook = hooks.find((h) => h.kind === "memo");
    expect(memoHook?.value).toEqual({ k: "primitive", type: "number", value: 14 });

    const contexts = snap!.contexts ?? [];
    expect(contexts.some((c) => c.value.k === "primitive" && c.value.value === "dark")).toBe(true);

    inst.stop();
  });

  it("captures the committed value after a targeted prop override", async () => {
    const frames: Frame[] = [];
    const { React, createRoot, act, bridge } = await react();
    const inst = createInstrumentation({ fiber: bridge, serializer: createSerializer() });
    inst.start({ captureDOM: true, interactionWindowMs: 200, onFrame: (f) => frames.push(f) });

    function Child({ flag }: { flag: boolean }) {
      return React.createElement("div", { className: "flagged" }, String(flag));
    }
    function Parent() {
      // Parent bails out on the override, so root.current can point at a stale
      // Child fiber — the regression guarded here.
      return React.createElement("div", null, React.createElement(Child, { flag: false }));
    }

    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(React.createElement(Parent));
    });

    const childId = frames.flatMap((f) => f.instances).find((i) => i.name === "Child")?.id;
    expect(childId).toBeDefined();
    // Requires the dev renderer's live-edit API (react-dom development build).
    expect(bridge.canEditValues()).toBe(true);

    await act(async () => {
      bridge.setProp(childId!, ["flag"], true);
    });
    await flush();

    const childSnap = frames
      .flatMap((f) => f.snapshots)
      .filter((s) => s.componentId === childId)
      .at(-1);
    const flag =
      childSnap?.props.k === "object"
        ? childSnap.props.entries?.find((e) => e[0] === "flag")?.[1]
        : undefined;

    // Snapshot must reflect the committed value (true), matching the DOM.
    expect(flag).toEqual({ k: "primitive", type: "boolean", value: true });
    expect(document.querySelector(".flagged")?.textContent).toBe("true");

    inst.stop();
  });

  it("attributes a commit to only the subtree that rendered", async () => {
    const frames: Frame[] = [];
    const { React, createRoot, act, bridge } = await react();
    const inst = createInstrumentation({ fiber: bridge, serializer: createSerializer() });
    inst.start({ captureDOM: false, interactionWindowMs: 200, onFrame: (f) => frames.push(f) });

    let bumpA: () => void = () => {};
    function WidgetA() {
      const [n, setN] = React.useState(0);
      bumpA = () => setN((v) => v + 1);
      return React.createElement("span", { className: "a" }, String(n));
    }
    function WidgetB() {
      // Sibling that must NOT appear in WidgetA's commit.
      return React.createElement("span", { className: "b" }, "static");
    }
    function Root() {
      return React.createElement(
        "div",
        null,
        React.createElement(WidgetA),
        React.createElement(WidgetB),
      );
    }

    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(React.createElement(Root));
    });
    const mountFrames = frames.length;
    // Isolated update to WidgetA only.
    await act(async () => bumpA());
    await flush();

    const newRenders = frames
      .slice(mountFrames)
      .flatMap((f) => f.events)
      .filter((e): e is RenderEvent => e.type === "render");
    const names = new Set(
      newRenders.map((r) => nameOf(frames, r.componentId as unknown as number)),
    );
    // WidgetA rendered; Root/WidgetB bailed and must be absent.
    expect(names.has("WidgetA")).toBe(true);
    expect(names.has("WidgetB")).toBe(false);
    expect(names.has("Root")).toBe(false);

    inst.stop();
  });
});

describe("interaction attribution — ignored containers", () => {
  beforeEach(() => {
    document.body.innerHTML = "<div id='root'></div>";
  });

  it("clicks inside an ignored container (the panel) record no interaction", async () => {
    const frames: Frame[] = [];
    const { bridge } = await react();
    const inst = createInstrumentation({ fiber: bridge, serializer: createSerializer() });
    inst.start({ captureDOM: false, interactionWindowMs: 200, onFrame: (f) => frames.push(f) });

    const panel = document.createElement("div");
    panel.id = "fake-panel";
    const panelButton = document.createElement("button");
    panel.appendChild(panelButton);
    document.body.appendChild(panel);
    bridge.ignoreContainer(panel);

    panelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    const interactions = frames.flatMap((f) => f.events).filter((e) => e.type === "interaction");
    expect(interactions).toHaveLength(0);

    // A click on page content is still recorded.
    document.getElementById("root")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    const after = frames.flatMap((f) => f.events).filter((e) => e.type === "interaction");
    expect(after).toHaveLength(1);

    inst.stop();
    panel.remove();
  });
});
