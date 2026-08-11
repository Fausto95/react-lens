import { describe, it, expect } from "vitest";
import { createFiberBridge } from "@reactlens/fiber";
import { createSerializer } from "@reactlens/serializer";
import { createInstrumentation } from "./instrumentation.js";
import type { EventsBatchMessage } from "@reactlens/protocol";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Frame = EventsBatchMessage["payload"];

/** Mirrors the extension's lens-hook.js stub: installed before React runs. */
function installStub(): void {
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
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("instrumentation surfaces the initial mount buffered by the stub", () => {
  it("emits the already-mounted tree when recording starts after mount", async () => {
    document.body.innerHTML = "<div id='root'></div>";
    installStub();
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");

    function Leaf() {
      return React.createElement("span", null, "leaf");
    }
    function App() {
      return React.createElement("div", null, React.createElement(Leaf));
    }

    // Mount happens while only the stub exists — no instrumentation yet.
    const root = createRoot(document.getElementById("root")!);
    await React.act(async () => {
      root.render(React.createElement(App));
    });

    // Recording starts late (panel opens): install() replays the buffer, and
    // because onCommit is subscribed first, the mounted tree is captured.
    const frames: Frame[] = [];
    const inst = createInstrumentation({
      fiber: createFiberBridge(globalThis),
      serializer: createSerializer(),
    });
    inst.start({ captureDOM: false, interactionWindowMs: 200, onFrame: (f) => frames.push(f) });
    await flush();

    const names = new Set(frames.flatMap((f) => f.instances).map((i) => i.name));
    expect(names.has("App")).toBe(true);
    expect(names.has("Leaf")).toBe(true);

    inst.stop();
  });
});
