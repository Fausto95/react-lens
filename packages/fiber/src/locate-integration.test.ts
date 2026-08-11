import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createFiberBridge, type FiberBridge } from "./bridge.js";
import type { ComponentId } from "@reactlens/protocol";

/**
 * `locateComponent` against real React: the path a production build depends
 * on, since nothing here reads dev-only fiber fields.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
});

describe("bridge.locateComponent", () => {
  it("locates a hook-using component in this test file", async () => {
    const { React, createRoot, act, bridge } = await react();
    const seen: ComponentId[] = [];
    bridge.onCommit((commit) => seen.push(...commit.rendered));

    function Counter() {
      const [n] = React.useState(0);
      return React.createElement("output", null, String(n));
    }
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(React.createElement(Counter));
    });

    const id = seen.find((cid) => bridge.getInstance(cid)?.name === "Counter");
    expect(id).toBeDefined();
    const loc = bridge.locateComponent(id!);
    expect(loc).toBeDefined();
    expect(loc!.file).toMatch(/locate-integration\.test\.ts$/);
    expect(loc!.line).toBeGreaterThan(0);
  });

  it("locating does not disturb the live app or the dispatcher", async () => {
    const { React, createRoot, act, bridge } = await react();
    const seen: ComponentId[] = [];
    bridge.onCommit((commit) => seen.push(...commit.rendered));

    let renders = 0;
    function Stateful({ label }: { label: string }) {
      const [n, setN] = React.useState(0);
      renders++;
      return React.createElement(
        "button",
        { onClick: () => setN(n + 1) },
        `${label}:${n}`,
      );
    }
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(React.createElement(Stateful, { label: "hits" }));
    });
    const rendersBefore = renders;

    const id = seen.find((cid) => bridge.getInstance(cid)?.name === "Stateful")!;
    expect(bridge.locateComponent(id)).toBeDefined();

    // The shallow call must not have re-rendered anything nor left the
    // dispatcher nulled — the app keeps working afterwards.
    expect(renders).toBe(rendersBefore);
    expect(document.querySelector("button")!.textContent).toBe("hits:0");
    await act(async () => {
      document.querySelector("button")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(document.querySelector("button")!.textContent).toBe("hits:1");
  });

  it("locates the inner function of a memo(forwardRef) component", async () => {
    const { React, createRoot, act, bridge } = await react();
    const seen: ComponentId[] = [];
    bridge.onCommit((commit) => seen.push(...commit.rendered));

    const Fancy = React.memo(
      React.forwardRef<HTMLSpanElement, { text: string }>(function FancyInner({ text }, ref) {
        return React.createElement("span", { ref }, text);
      }),
    );
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(React.createElement(Fancy, { text: "hi" }));
    });

    const id = seen.find((cid) => bridge.getInstance(cid)?.name?.includes("FancyInner"));
    expect(id).toBeDefined();
    const loc = bridge.locateComponent(id!);
    // Must be OUR file, not react.js where the memo wrapper was created.
    expect(loc!.file).toMatch(/locate-integration\.test\.ts$/);
  });

  it("returns undefined for an unknown component id", async () => {
    const { bridge } = await react();
    expect(bridge.locateComponent(999999 as unknown as ComponentId)).toBeUndefined();
  });
});
