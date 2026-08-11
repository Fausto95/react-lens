import { describe, it, expect } from "vite-plus/test";
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

describe("multiple bridges share one hook", () => {
  it("a bridge installed after another still receives commits", async () => {
    // The real-world shape of this: the extension's injected bridge chains the
    // hook at document_start, then the page's embedded runtime installs its own
    // bridge. Both must observe commits — the guard must not be a flag on the
    // shared hook, or the first bridge makes every later one deaf.
    document.body.innerHTML = "<div id='root2'></div>";
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");

    const first = createFiberBridge(globalThis); // e.g. the extension's bridge
    first.install();
    const second = createFiberBridge(globalThis); // e.g. the embedded runtime
    second.install();

    const seenByFirst: string[] = [];
    const seenBySecond: string[] = [];
    const nameInto = (bridge: ReturnType<typeof createFiberBridge>, out: string[]) =>
      bridge.onCommit((commit) => {
        for (const id of commit.rendered) {
          const inst = bridge.getInstance(id);
          if (inst) out.push(inst.name);
        }
      });
    nameInto(first, seenByFirst);
    nameInto(second, seenBySecond);

    function Leaf() {
      return React.createElement("em", null, "leaf");
    }
    const root = createRoot(document.getElementById("root2")!);
    await React.act(async () => {
      root.render(React.createElement(Leaf));
    });

    expect(seenByFirst).toContain("Leaf");
    expect(seenBySecond).toContain("Leaf");
  });

  it("installing the same bridge twice does not duplicate commits", async () => {
    document.body.innerHTML = "<div id='root3'></div>";
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");

    const bridge = createFiberBridge(globalThis);
    bridge.install();
    bridge.install();

    let commits = 0;
    bridge.onCommit(() => {
      commits += 1;
    });

    function Once() {
      return React.createElement("i", null, "once");
    }
    const root = createRoot(document.getElementById("root3")!);
    await React.act(async () => {
      root.render(React.createElement(Once));
    });

    expect(commits).toBe(1);
  });
});
