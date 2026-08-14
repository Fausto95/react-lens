import { describe, expect, it } from "vite-plus/test";
import type { Fiber } from "./react-internals.js";
import { eventHandlerName } from "./event-handler.js";

function fiber(props: Record<string, unknown>, parent: Fiber | null = null): Fiber {
  return {
    tag: 5,
    key: null,
    elementType: "button",
    type: "button",
    stateNode: null,
    return: parent,
    child: null,
    sibling: null,
    index: 0,
    memoizedProps: props,
    memoizedState: null,
    pendingProps: props,
    updateQueue: null,
    dependencies: null,
    flags: 0,
    subtreeFlags: 0,
    alternate: null,
  };
}

function nodeFor(value: Fiber): Node {
  return { __reactFiber$reactlens: value } as unknown as Node;
}

describe("eventHandlerName", () => {
  it("uses the named callback on the event target", () => {
    function handleAddToCart() {}
    expect(eventHandlerName(nodeFor(fiber({ onClick: handleAddToCart })), "click")).toBe(
      "handleAddToCart",
    );
  });

  it("walks the React ancestor chain for delegated handlers", () => {
    function submitCheckout() {}
    const form = fiber({ onSubmit: submitCheckout });
    const button = fiber({}, form);
    expect(eventHandlerName(nodeFor(button), "submit")).toBe("submitCheckout");
  });

  it("prefers displayName when available", () => {
    const handler = Object.assign(function internalHandler() {}, { displayName: "savePreferences" });
    expect(eventHandlerName(nodeFor(fiber({ onClick: handler })), "click")).toBe(
      "savePreferences",
    );
  });

  it("returns undefined when React does not expose a useful named callback", () => {
    const tiny = Object.defineProperty(() => {}, "name", { value: "a" });
    expect(eventHandlerName(nodeFor(fiber({ onClick: tiny })), "click")).toBeUndefined();
    expect(eventHandlerName(nodeFor(fiber({})), "click")).toBeUndefined();
  });
});
