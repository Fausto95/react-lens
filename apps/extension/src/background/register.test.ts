import { describe, it, expect } from "vite-plus/test";
import { registerWithRetry, RETRY_DELAYS_MS } from "./register.js";

/** Records what was attempted, and fails the first `failures` attempts. */
function fakeRegistrar(failures: number, error = new Error("No SW")) {
  let attempts = 0;
  return {
    get attempts() {
      return attempts;
    },
    register: async () => {
      attempts++;
      if (attempts <= failures) throw error;
    },
  };
}

const noWait = async () => {};

describe("registerWithRetry", () => {
  it("registers once when the worker is ready", async () => {
    const r = fakeRegistrar(0);
    const result = await registerWithRetry(r.register, { wait: noWait });
    expect(result.ok).toBe(true);
    expect(r.attempts).toBe(1);
  });

  it("recovers from the service worker not being ready yet", async () => {
    // Chrome throws "No SW" if registration races the worker's own startup.
    // Giving up there left the MAIN-world hook unregistered, so React Lens was
    // silently dead on every page for the rest of the session.
    const r = fakeRegistrar(2);
    const result = await registerWithRetry(r.register, { wait: noWait });
    expect(result.ok).toBe(true);
    expect(r.attempts).toBe(3);
  });

  it("gives up after the last delay rather than looping forever", async () => {
    const r = fakeRegistrar(Number.POSITIVE_INFINITY);
    const result = await registerWithRetry(r.register, { wait: noWait });
    expect(result.ok).toBe(false);
    expect(r.attempts).toBe(RETRY_DELAYS_MS.length + 1);
  });

  it("reports the last failure so it can be surfaced, not swallowed", async () => {
    const boom = new Error("No SW");
    const r = fakeRegistrar(Number.POSITIVE_INFINITY, boom);
    const result = await registerWithRetry(r.register, { wait: noWait });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(boom);
  });

  it("backs off between attempts instead of hammering", async () => {
    const waited: number[] = [];
    const r = fakeRegistrar(2);
    await registerWithRetry(r.register, {
      wait: async (ms) => {
        waited.push(ms);
      },
    });
    expect(waited).toEqual(RETRY_DELAYS_MS.slice(0, 2));
  });
});
