import { describe, it, expect, beforeEach } from "vite-plus/test";
import { clearErrors, lensErrors } from "./errors.js";
import { ErrorBoundary } from "./ErrorBoundary.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  clearErrors();
  document.body.innerHTML = "<div id='root'></div>";
});

/** Mount `element` into a fresh root and return the container. */
async function mount(element: unknown) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  await React.act(async () => {
    root.render(element as never);
  });
  return { container, root, React };
}

describe("panel error boundary", () => {
  it("renders its region normally when nothing throws", async () => {
    const React = await import("react");
    const { container } = await mount(
      React.createElement(ErrorBoundary, { scope: "timeline" }, React.createElement("p", null, "ok")),
    );

    expect(container.textContent).toContain("ok");
    expect(lensErrors()).toEqual([]);
  });

  it("contains a throwing region and keeps its siblings alive", async () => {
    // A crashing timeline must not take the tree, the inspector, or the port
    // effect down with it.
    const React = await import("react");
    function Boom(): never {
      throw new Error("bad clip");
    }
    const { container } = await mount(
      React.createElement(
        "div",
        null,
        React.createElement(ErrorBoundary, { scope: "timeline" }, React.createElement(Boom)),
        React.createElement("p", null, "tree still here"),
      ),
    );

    expect(container.textContent).toContain("tree still here");
    expect(container.textContent).not.toContain("bad clip lives on");
    expect(container.querySelector(".rl-region-error")).not.toBeNull();
  });

  it("reports the failure to the single error seam with its scope", async () => {
    const React = await import("react");
    function Boom(): never {
      throw new Error("bad clip");
    }
    await mount(
      React.createElement(ErrorBoundary, { scope: "timeline" }, React.createElement(Boom)),
    );

    expect(lensErrors().map((e) => [e.scope, e.message])).toEqual([["timeline", "bad clip"]]);
  });

  it("re-renders the region when the user retries", async () => {
    const React = await import("react");
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("transient");
      return React.createElement("p", null, "recovered");
    }
    const { container } = await mount(
      React.createElement(ErrorBoundary, { scope: "timeline" }, React.createElement(Flaky)),
    );
    expect(container.querySelector(".rl-region-error")).not.toBeNull();

    shouldThrow = false;
    const retry = container.querySelector<HTMLButtonElement>(".rl-region-error button")!;
    await React.act(async () => {
      retry.click();
    });

    expect(container.textContent).toContain("recovered");
    expect(container.querySelector(".rl-region-error")).toBeNull();
  });
});
