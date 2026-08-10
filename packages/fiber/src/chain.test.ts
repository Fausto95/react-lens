import { describe, it, expect } from "vitest";
import { createFiberBridge } from "./index.js";

// Marks this as a valid React test environment for act().
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Mimics `lens-hook.js`: a zero-import stub that wins the DevTools hook slot at
 * document_start and buffers every commit root until the heavy bridge loads.
 * react-dom reads the hook exactly once at module init, so this MUST be present
 * before the first `react-dom/client` import below.
 */
function installStub(): { queue: unknown[] } {
  const queue: unknown[] = [];
  const renderers = new Map<number, unknown>();
  let seq = 0;
  const hook = {
    _lensStub: true,
    _lensQueue: queue,
    renderers,
    supportsFiber: true,
    checkDCE() {},
    inject(r: unknown) {
      renderers.set(++seq, r);
      return seq;
    },
    onCommitFiberRoot(_id: number, root: unknown) {
      queue.push(root);
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
  };
  Object.defineProperty(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
    value: hook,
    configurable: true,
    writable: true,
  });
  return { queue };
}

describe("bridge chains the document_start stub and replays its buffer", () => {
  it("captures the already-mounted tree when the bridge loads after React", async () => {
    document.body.innerHTML = "<div id='root'></div>";
    // 1. The stub is installed before React ever runs (the extension's fix).
    const { queue } = installStub();
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");

    function Child() {
      return React.createElement("span", null, "hi");
    }
    function App() {
      return React.createElement("div", null, React.createElement(Child));
    }

    // 2. React mounts while only the stub exists — every commit is buffered.
    const root = createRoot(document.getElementById("root")!);
    await React.act(async () => {
      root.render(React.createElement(App));
    });
    expect(queue.length).toBeGreaterThan(0);

    // 3. The heavy bridge loads late (crxjs async loader), chains the stub, and
    //    replays the buffer — so the mounted tree appears despite the late load.
    const bridge = createFiberBridge(globalThis);
    const captured: string[] = [];
    bridge.onCommit((commit) => {
      for (const id of commit.rendered) {
        const inst = bridge.getInstance(id);
        if (inst) captured.push(inst.name);
      }
    });
    bridge.install();

    expect(captured).toContain("App");
    expect(captured).toContain("Child");
    // The buffer is drained once replayed.
    expect(queue.length).toBe(0);
  });
});
