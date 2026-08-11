import { describe, it, expect } from "vitest";
import { createFiberBridge } from "./bridge.js";
import { captureStateHooks, inspectHooks } from "./inspect.js";
import type { Fiber } from "./react-internals.js";
import { FunctionComponent } from "./react-internals.js";
import type { ComponentId } from "@reactlens/protocol";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Bare-minimum function-component fiber wrapping a fake hook list. */
function fakeFiber(hooks: Array<{ memoizedState: unknown; queue: unknown }>): Fiber {
  let head: unknown = null;
  for (let i = hooks.length - 1; i >= 0; i--) {
    head = { ...hooks[i], next: head };
  }
  return {
    tag: FunctionComponent,
    key: null,
    elementType: null,
    type: null,
    stateNode: null,
    return: null,
    child: null,
    sibling: null,
    index: 0,
    memoizedProps: null,
    memoizedState: head,
    pendingProps: null,
    updateQueue: null,
    dependencies: null,
    flags: 0,
    subtreeFlags: 0,
    alternate: null,
  };
}

describe("captureStateHooks", () => {
  it("captures raw values of state/reducer hooks only, at raw list indices", () => {
    const fiber = fakeFiber([
      { memoizedState: { current: "a ref" }, queue: null },              // 0: useRef
      { memoizedState: 42, queue: {} },                                   // 1: useState
      { memoizedState: { create: () => {}, deps: [], tag: 0b1000 }, queue: null }, // 2: effect
      { memoizedState: { items: [1, 2] }, queue: {} },                    // 3: useReducer
    ]);
    const captured = captureStateHooks(fiber);
    expect(captured).toEqual([
      { index: 1, value: 42 },
      { index: 3, value: { items: [1, 2] } },
    ]);
    // Values are references, not clones.
    const reducerValue = captured[1]!.value;
    expect(reducerValue).toBe((inspectHooks(fiber)[3] as { value: unknown }).value);
  });

  it("keeps index accounting aligned with inspectHooks across skipped nodes", () => {
    const sentinel = Symbol.for("react.memo_cache_sentinel");
    const fiber = fakeFiber([
      { memoizedState: [sentinel, 1, 2], queue: null }, // 0: compiler memo cache (skipped by inspectHooks)
      { memoizedState: "hello", queue: {} },            // 1: useState
    ]);
    const captured = captureStateHooks(fiber);
    expect(captured).toEqual([{ index: 1, value: "hello" }]);
    const inspected = inspectHooks(fiber).find((h) => h.kind === "state");
    expect(inspected?.index).toBe(1);
  });

  it("returns empty for non-function fibers and hookless fibers", () => {
    expect(captureStateHooks(fakeFiber([]))).toEqual([]);
    const classFiber = { ...fakeFiber([]), tag: 1 };
    expect(captureStateHooks(classFiber)).toEqual([]);
  });
});

describe("setClassState / hasFiber", () => {
  it("replaces a class component's state and re-renders, no override API needed", async () => {
    document.body.innerHTML = "<div id='ct-root'></div>";
    const bridge = createFiberBridge(globalThis);
    bridge.install();
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");

    class Counter extends React.Component<Record<string, never>, { count: number }> {
      override state = { count: 0 };
      override render() {
        return React.createElement("output", null, `count:${this.state.count}`);
      }
    }

    let counterId: ComponentId | undefined;
    bridge.onCommit((commit) => {
      for (const id of commit.rendered) {
        if (bridge.getInstance(id)?.name === "Counter") counterId = id;
      }
    });

    const root = createRoot(document.getElementById("ct-root")!);
    await React.act(async () => {
      root.render(React.createElement(Counter));
    });
    expect(counterId).toBeDefined();
    expect(bridge.hasFiber(counterId!)).toBe(true);
    expect(bridge.hasFiber(999_999 as ComponentId)).toBe(false);

    let ok = false;
    await React.act(async () => {
      ok = bridge.setClassState(counterId!, { count: 41 });
    });
    expect(ok).toBe(true);
    expect(document.querySelector("output")!.textContent).toBe("count:41");
  });
});
