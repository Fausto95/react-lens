import { describe, it, expect, beforeEach } from "vite-plus/test";
import { REACT_LENS_GLOBAL, installPageApi } from "@reactlens/protocol";
import type { ReactLensPageApi, TimeTravelStoreAdapter } from "@reactlens/protocol";
import { createStoreAdapter, registerStore, registerStores } from "./register.js";

type Global = Record<string, unknown>;

function fakeHost() {
  const registered: TimeTravelStoreAdapter[] = [];
  const api: ReactLensPageApi = {
    markInteraction: () => {},
    registerStore(adapter) {
      registered.push(adapter);
      return () => {
        const i = registered.indexOf(adapter);
        if (i >= 0) registered.splice(i, 1);
      };
    },
  };
  return { api, registered };
}

const adapter = (id: string): TimeTravelStoreAdapter => ({
  id,
  getSnapshot: () => id,
  applySnapshot: () => {},
});

beforeEach(() => {
  delete (globalThis as Global)[REACT_LENS_GLOBAL];
});

describe("createStoreAdapter", () => {
  it("wraps get/set into the adapter shape", () => {
    let value = 1;
    const a = createStoreAdapter({
      id: "counter",
      get: () => value,
      set: (next) => {
        value = next;
      },
    });
    expect(a.id).toBe("counter");
    expect(a.getSnapshot()).toBe(1);
    a.applySnapshot(9);
    expect(value).toBe(9);
  });
});

describe("registerStore", () => {
  it("registers against a host that is already installed", () => {
    const host = fakeHost();
    installPageApi(globalThis, host.api);
    registerStore(adapter("cart"));
    expect(host.registered.map((a) => a.id)).toEqual(["cart"]);
  });

  it("queues before a host installs and is adopted on install", () => {
    // The order every real app hits: modules evaluate, then whichever host is
    // capturing installs. Nothing may be lost in between.
    registerStore(adapter("cart"));
    registerStore(adapter("session"));
    const host = fakeHost();
    installPageApi(globalThis, host.api);
    expect(host.registered.map((a) => a.id)).toEqual(["cart", "session"]);
  });

  it("an unregister issued before install is honoured at install", () => {
    const off = registerStore(adapter("cart"));
    off();
    const host = fakeHost();
    installPageApi(globalThis, host.api);
    expect(host.registered).toEqual([]);
  });

  it("an unregister issued after install reaches the host", () => {
    const off = registerStore(adapter("cart"));
    const host = fakeHost();
    installPageApi(globalThis, host.api);
    expect(host.registered).toHaveLength(1);
    off();
    expect(host.registered).toEqual([]);
  });

  it("is a no-op when React Lens never runs", () => {
    // Production, or dev without the extension: registering must not throw and
    // unregistering must stay safe.
    const off = registerStore(adapter("cart"));
    expect(() => off()).not.toThrow();
  });

  it("registerStores unregisters every adapter through one disposer", () => {
    const host = fakeHost();
    installPageApi(globalThis, host.api);
    const off = registerStores(adapter("a"), adapter("b"));
    expect(host.registered).toHaveLength(2);
    off();
    expect(host.registered).toEqual([]);
  });
});
