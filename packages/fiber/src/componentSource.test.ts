import { describe, it, expect } from "vite-plus/test";
import { unwrapComponentFunction } from "./componentSource.js";

/**
 * Which function actually carries a component's definition site: React wraps
 * user functions in memo/forwardRef objects, and the wrapper is created in
 * React's own module — only the inner function points at user code.
 */
describe("unwrapComponentFunction", () => {
  it("returns plain function and class components unchanged", () => {
    function Card() {
      return null;
    }
    class Widget {
      render() {
        return null;
      }
    }
    expect(unwrapComponentFunction(Card)).toBe(Card);
    expect(unwrapComponentFunction(Widget)).toBe(Widget);
  });

  it("unwraps forwardRef to its render function", () => {
    const render = (_props: unknown, _ref: unknown) => null;
    const forwardRefType = { $$typeof: Symbol.for("react.forward_ref"), render };
    expect(unwrapComponentFunction(forwardRefType)).toBe(render);
  });

  it("unwraps memo to its inner type", () => {
    function Inner() {
      return null;
    }
    const memoType = { $$typeof: Symbol.for("react.memo"), type: Inner };
    expect(unwrapComponentFunction(memoType)).toBe(Inner);
  });

  it("unwraps memo(forwardRef(fn)) through both layers", () => {
    const render = (_props: unknown, _ref: unknown) => null;
    const memoType = {
      $$typeof: Symbol.for("react.memo"),
      type: { $$typeof: Symbol.for("react.forward_ref"), render },
    };
    expect(unwrapComponentFunction(memoType)).toBe(render);
  });

  it("returns null for host tags, lazy, and unresolvable shapes", () => {
    expect(unwrapComponentFunction("div")).toBeNull();
    expect(unwrapComponentFunction({ $$typeof: Symbol.for("react.lazy") })).toBeNull();
    expect(unwrapComponentFunction(null)).toBeNull();
    expect(unwrapComponentFunction(undefined)).toBeNull();
    expect(unwrapComponentFunction({})).toBeNull();
  });

  it("stops rather than looping on a self-referential wrapper", () => {
    const cyclic: { $$typeof: symbol; type?: unknown } = { $$typeof: Symbol.for("react.memo") };
    cyclic.type = cyclic;
    expect(unwrapComponentFunction(cyclic)).toBeNull();
  });
});
