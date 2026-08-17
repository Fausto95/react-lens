import { describe, it, expect, beforeEach } from "vite-plus/test";
import { REACT_LENS_GLOBAL, installPageApi, resolvePageApi } from "./page-api.js";
import type { ReactLensPageApi, TimeTravelStoreAdapter } from "./index.js";

const adapter = (id: string): TimeTravelStoreAdapter => ({
  id,
  getSnapshot: () => id,
  applySnapshot: () => {},
});

function fakeHost() {
  const registered: string[] = [];
  const api: ReactLensPageApi = {
    markInteraction: () => {},
    registerStore(a) {
      registered.push(a.id);
      return () => {
        const i = registered.indexOf(a.id);
        if (i >= 0) registered.splice(i, 1);
      };
    },
  };
  return { api, registered };
}

let target: Record<string, unknown>;
beforeEach(() => {
  target = {};
});

describe("resolvePageApi", () => {
  it("returns the installed host API when there is one", () => {
    const host = fakeHost();
    installPageApi(target, host.api);
    expect(resolvePageApi(target)).toBe(host.api);
  });

  it("leaves a stub that a later install adopts", () => {
    resolvePageApi(target)!.registerStore(adapter("cart"));
    const host = fakeHost();
    installPageApi(target, host.api);
    expect(host.registered).toEqual(["cart"]);
    // The stub is gone: the host owns the global now.
    expect(target[REACT_LENS_GLOBAL]).toBe(host.api);
  });

  it("reuses one stub across calls, so every pending registration is adopted", () => {
    resolvePageApi(target)!.registerStore(adapter("a"));
    resolvePageApi(target)!.registerStore(adapter("b"));
    const host = fakeHost();
    installPageApi(target, host.api);
    expect(host.registered).toEqual(["a", "b"]);
  });

  it("returns null when there is no global object to attach to", () => {
    expect(resolvePageApi(undefined)).toBeNull();
  });
});

describe("installPageApi", () => {
  it("skips adapters the page unregistered before the host arrived", () => {
    const off = resolvePageApi(target)!.registerStore(adapter("cart"));
    off();
    const host = fakeHost();
    installPageApi(target, host.api);
    expect(host.registered).toEqual([]);
  });

  it("routes an unregister issued after install through to the host", () => {
    const off = resolvePageApi(target)!.registerStore(adapter("cart"));
    const host = fakeHost();
    installPageApi(target, host.api);
    off();
    expect(host.registered).toEqual([]);
  });

  it("a second install adopts nothing, since the first host drained the queue", () => {
    // Page navigation in the extension: the bridge re-installs against a fresh
    // instrumentation. Re-registering the old adapters would double them up.
    resolvePageApi(target)!.registerStore(adapter("cart"));
    const first = fakeHost();
    installPageApi(target, first.api);
    const second = fakeHost();
    installPageApi(target, second.api);
    expect(second.registered).toEqual([]);
  });
});
