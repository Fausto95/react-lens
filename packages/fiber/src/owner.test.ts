import { describe, expect, it } from "vite-plus/test";
import { createFiberBridge, ownerComponentOf } from "./bridge.js";
import { FunctionComponent, type Fiber } from "./react-internals.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("owner capture", () => {
  it("records the component that created the element, not the one that placed it", async () => {
    document.body.innerHTML = "<div id='owner-root'></div>";
    // react-dom reads the DevTools hook once at module init, so the bridge must
    // own that slot before the first import below.
    const bridge = createFiberBridge(globalThis);
    bridge.install();
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");

    const names = new Map<string, ReturnType<typeof bridge.getInstance>>();
    bridge.onCommit((commit) => {
      for (const id of commit.rendered) {
        const inst = bridge.getInstance(id);
        if (inst) names.set(inst.name, inst);
      }
    });

    function Card() {
      return React.createElement("b", null, "card");
    }
    function Layout({ children }: { children: React.ReactNode }) {
      return React.createElement("section", null, children);
    }
    // App creates <Card/> and hands it to Layout: Layout is the parent, App the owner.
    function App() {
      return React.createElement(Layout, null, React.createElement(Card));
    }

    const root = createRoot(document.getElementById("owner-root")!);
    await React.act(async () => {
      root.render(React.createElement(App));
    });

    const app = names.get("App")!;
    const layout = names.get("Layout")!;
    const card = names.get("Card")!;
    expect(card.parentId).toBe(layout.id);
    expect(card.ownerId).toBe(app.id);
    // Layout's element was also created by App, which is its parent too.
    expect(layout.ownerId).toBe(app.id);
    expect(app.ownerId).toBeUndefined();
  });

  it("does not crash on a React 19 server-component owner, which is not a fiber", () => {
    const fiber = {
      tag: FunctionComponent,
      return: null,
      // Flight attaches a ReactComponentInfo here: it has a name, no tag and no return.
      _debugOwner: { name: "ServerPage", env: "Server" },
    } as unknown as Fiber;
    expect(ownerComponentOf(fiber)).toBe(null);
  });
});
