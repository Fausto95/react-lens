import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { TraceStore } from "@reactlens/trace-engine";
import type {
  ComponentId,
  RenderId,
  CommitId,
  EventId,
  RenderEvent,
  ComponentInstance,
  EventsBatchMessage,
  TimeTravelEntry,
  TimeTravelResult,
} from "@reactlens/protocol";
import {
  createPanelTimeTravel,
  type RestoreStatus,
  type TimeTravelApi,
} from "./timeTravelController.js";

const cid = (n: number) => n as ComponentId;
const rid = (n: number) => n as RenderId;

let eventSeq = 0;
function renderEvent(over: Partial<RenderEvent>): RenderEvent {
  return {
    id: ++eventSeq as EventId,
    type: "render",
    timestamp: eventSeq,
    renderId: eventSeq as RenderId,
    commitId: 1 as CommitId,
    componentId: cid(1),
    selfDuration: 1,
    totalDuration: 1,
    reasons: [],
    compiler: { compiled: false, memoized: false },
    ...over,
  };
}

function instance(id: number, name: string): ComponentInstance {
  return {
    id: cid(id),
    type: id as never,
    name,
    rootId: 1 as never,
    compiler: { compiled: false, memoized: false },
  };
}

function batch(over: Partial<EventsBatchMessage["payload"]>): EventsBatchMessage["payload"] {
  return { events: [], snapshots: [], instances: [], ...over };
}

/** Store with components 1 and 2: c1 renders at t=100 (r10) and t=200 (r12), c2 at t=150 (r11). */
function makeStore(): TraceStore {
  const store = new TraceStore();
  store.ingest(
    batch({
      instances: [instance(1, "A"), instance(2, "B")],
      events: [
        renderEvent({ componentId: cid(1), renderId: rid(10), timestamp: 100 }),
        renderEvent({ componentId: cid(2), renderId: rid(11), timestamp: 150 }),
        renderEvent({ componentId: cid(1), renderId: rid(12), timestamp: 200 }),
      ],
    }),
  );
  return store;
}

const ok = (entries: TimeTravelEntry[]): TimeTravelResult => ({
  applied: entries.length,
  failed: 0,
  supported: true,
  failures: [],
});

function fakeApi(
  applyImpl?: (entries: TimeTravelEntry[]) => TimeTravelResult | Promise<TimeTravelResult>,
): TimeTravelApi & { applies: TimeTravelEntry[][]; goLives: number } {
  const api = {
    applies: [] as TimeTravelEntry[][],
    goLives: 0,
    supported: () => true,
    apply(entries: TimeTravelEntry[]) {
      api.applies.push(entries);
      return applyImpl ? applyImpl(entries) : ok(entries);
    },
    goLive() {
      api.goLives++;
      return { applied: 0, failed: 0, supported: true, failures: [] };
    },
  };
  return api;
}

let rafQueue: FrameRequestCallback[] = [];
function flushRaf(): void {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(0);
}
/** Let awaited apply results propagate through the controller. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPanelTimeTravel — coalescing", () => {
  it("coalesces cursor moves into one apply at the latest t", async () => {
    const api = fakeApi();
    const ctl = createPanelTimeTravel(makeStore(), api);
    ctl.onCursor({ t: 120, mode: "historical" }, true);
    ctl.onCursor({ t: 250, mode: "historical" }, true);
    flushRaf();
    await settle();
    expect(api.applies).toHaveLength(1);
    expect(api.applies[0]).toEqual(
      expect.arrayContaining([
        { componentId: cid(1), renderId: rid(12) },
        { componentId: cid(2), renderId: rid(11) },
      ]),
    );
    ctl.dispose();
  });
});

describe("createPanelTimeTravel — restore status", () => {
  it("publishes applied count and per-component failures", async () => {
    const api = fakeApi((entries) => ({
      applied: entries.length - 1,
      failed: 1,
      supported: true,
      failures: [{ componentId: cid(2), renderId: rid(11), reason: "no-history" }],
    }));
    const statuses: Array<RestoreStatus | null> = [];
    const ctl = createPanelTimeTravel(makeStore(), api, (s) => statuses.push(s));
    ctl.onCursor({ t: 250, mode: "historical" }, true);
    flushRaf();
    await settle();
    const last = statuses.at(-1);
    expect(last).not.toBeNull();
    expect(last!.applied).toBe(1);
    expect(last!.failedIds.get(cid(2))).toBe("no-history");
    expect(last!.failedIds.has(cid(1))).toBe(false);
    ctl.dispose();
  });

  it("accumulates across deltas and recovers components that later succeed", async () => {
    let failNext = true;
    const api = fakeApi((entries) =>
      failNext
        ? {
            applied: 0,
            failed: entries.length,
            supported: true,
            failures: entries.map((e) => ({ ...e, reason: "no-history" as const })),
          }
        : ok(entries),
    );
    const statuses: Array<RestoreStatus | null> = [];
    const ctl = createPanelTimeTravel(makeStore(), api, (s) => statuses.push(s));

    ctl.onCursor({ t: 120, mode: "historical" }, true); // c1@r10 fails
    flushRaf();
    await settle();
    expect(statuses.at(-1)!.failedIds.has(cid(1))).toBe(true);

    failNext = false;
    ctl.onCursor({ t: 250, mode: "historical" }, true); // c1@r12, c2@r11 succeed
    flushRaf();
    await settle();
    const last = statuses.at(-1)!;
    expect(last.failedIds.size).toBe(0);
    expect(last.applied).toBe(2);
    ctl.dispose();
  });

  it("ignores a stale result that resolves after a newer one", async () => {
    let resolveFirst!: (r: TimeTravelResult) => void;
    let call = 0;
    const api = fakeApi((entries) => {
      call++;
      if (call === 1) return new Promise<TimeTravelResult>((r) => (resolveFirst = r));
      return ok(entries);
    });
    const statuses: Array<RestoreStatus | null> = [];
    const ctl = createPanelTimeTravel(makeStore(), api, (s) => statuses.push(s));

    ctl.onCursor({ t: 120, mode: "historical" }, true); // apply #1: pending
    flushRaf();
    ctl.onCursor({ t: 250, mode: "historical" }, true); // apply #2: resolves first
    flushRaf();
    await settle();
    const afterSecond = statuses.at(-1)!;

    resolveFirst({
      applied: 0,
      failed: 1,
      supported: true,
      failures: [{ componentId: cid(1), renderId: rid(10), reason: "write-failed" }],
    });
    await settle();
    // The late gen-1 failure must not overwrite the newer status.
    expect(statuses.at(-1)).toEqual(afterSecond);
    ctl.dispose();
  });

  it("routes apply rejections into failed status for the whole delta", async () => {
    const api = fakeApi(() => Promise.reject(new Error("port died")));
    const statuses: Array<RestoreStatus | null> = [];
    const ctl = createPanelTimeTravel(makeStore(), api, (s) => statuses.push(s));
    ctl.onCursor({ t: 250, mode: "historical" }, true);
    flushRaf();
    await settle();
    const last = statuses.at(-1)!;
    expect(last.failedIds.get(cid(1))).toBe("write-failed");
    expect(last.failedIds.get(cid(2))).toBe("write-failed");
    ctl.dispose();
  });

  it("emits null and resets accumulation on goLive", async () => {
    const api = fakeApi();
    const statuses: Array<RestoreStatus | null> = [];
    const ctl = createPanelTimeTravel(makeStore(), api, (s) => statuses.push(s));
    ctl.onCursor({ t: 250, mode: "historical" }, true);
    flushRaf();
    await settle();
    expect(statuses.at(-1)).not.toBeNull();

    ctl.onCursor({ t: 250, mode: "live" }, true);
    expect(statuses.at(-1)).toBeNull();
    expect(api.goLives).toBe(1);

    // Fresh travel starts a clean slate.
    ctl.onCursor({ t: 120, mode: "historical" }, true);
    flushRaf();
    await settle();
    expect(statuses.at(-1)!.applied).toBe(1);
    ctl.dispose();
  });
});

describe("createPanelTimeTravel — hidden-tab scheduling", () => {
  it("applies via the timeout fallback when rAF never fires", async () => {
    // Hidden/backgrounded tabs pause requestAnimationFrame entirely; the
    // controller must not stall scrubs behind it.
    const api = fakeApi();
    const ctl = createPanelTimeTravel(makeStore(), api);
    ctl.onCursor({ t: 250, mode: "historical" }, true);
    // No flushRaf() on purpose — only timers run.
    await new Promise((r) => setTimeout(r, 50));
    expect(api.applies).toHaveLength(1);
    ctl.dispose();
  });

  it("does not double-apply when both rAF and the fallback fire", async () => {
    const api = fakeApi();
    const ctl = createPanelTimeTravel(makeStore(), api);
    ctl.onCursor({ t: 250, mode: "historical" }, true);
    flushRaf();
    await new Promise((r) => setTimeout(r, 50));
    expect(api.applies).toHaveLength(1);
    ctl.dispose();
  });
});
