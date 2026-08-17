import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createFiberBridge } from "@reactlens/fiber";
import { createSerializer } from "@reactlens/serializer";
import { createInstrumentation } from "./instrumentation.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => new Promise((r) => setTimeout(r, 0));

let sharedBridge: ReturnType<typeof createFiberBridge> | undefined;

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
});

async function setup() {
  if (!sharedBridge) {
    sharedBridge = createFiberBridge(globalThis);
    sharedBridge.install();
  }
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const inst = createInstrumentation({ fiber: sharedBridge, serializer: createSerializer() });
  inst.start({ captureDOM: true, interactionWindowMs: 200, onFrame: () => {} });
  return { React, createRoot, inst };
}

/**
 * `snapshotPage` is how the panel checks that a restore actually reached the
 * paint: it compares this against the DOM captured at the cursor time. Without
 * it, the panel can only report that its writes succeeded — never that the page
 * agrees.
 */
describe("snapshotPage", () => {
  it("returns the current DOM of the last captured container", async () => {
    const { React, createRoot, inst } = await setup();
    function Swatch({ hue }: { hue: string }) {
      return React.createElement("span", { className: `sw ${hue}` }, hue);
    }
    const root = createRoot(document.getElementById("root")!);
    await React.act(async () => {
      root.render(React.createElement(Swatch, { hue: "red" }));
    });
    await flush();

    const first = inst.snapshotPage();
    expect(JSON.stringify(first)).toContain("sw red");

    await React.act(async () => {
      root.render(React.createElement(Swatch, { hue: "blue" }));
    });
    await flush();

    // Reads the DOM as it stands now, not the capture — that is the whole point.
    expect(JSON.stringify(inst.snapshotPage())).toContain("sw blue");
    inst.stop();
  });

  it("is undefined before any commit has been observed", async () => {
    const { inst } = await setup();
    expect(inst.snapshotPage()).toBeUndefined();
    inst.stop();
  });
});
