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

/** A TimeTravelResult with every field defaulted — specs state only what they exercise. */
const result = (partial: Partial<TimeTravelResult> = {}): TimeTravelResult => ({
  applied: 0,
  failed: 0,
  supported: true,
  failures: [],
  storesApplied: 0,
  storeFailures: [],
  ...partial,
});

const ok = (entries: TimeTravelEntry[]): TimeTravelResult => result({ applied: entries.length });

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
      return result();
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
/** Verification is debounced past the last scrub frame, so it needs real time. */
const settleVerify = () => new Promise<void>((r) => setTimeout(r, 220));

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

describe("createPanelTimeTravel — restore verification", () => {
  /** A store whose commit DOM at t=200 is a red swatch. */
  function storeWithDom(): TraceStore {
    const store = makeStore();
    store.ingest(
      batch({
        commitSnapshots: [
          {
            commitId: 1 as CommitId,
            timestamp: 200,
            dom: {
              root: {
                nodeName: "DIV",
                children: [{ nodeName: "SPAN", attributes: { class: "sw red" } }],
              },
            },
          },
        ],
      }),
    );
    return store;
  }

  it("reports nothing when the page matches the capture", async () => {
    const store = storeWithDom();
    const api = {
      ...fakeApi(),
      snapshotPage: () => ({
        root: {
          nodeName: "DIV",
          children: [{ nodeName: "SPAN", attributes: { class: "sw red" } }],
        },
      }),
    };
    const statuses: Array<RestoreStatus | null> = [];
    const ctl = createPanelTimeTravel(store, api, (s) => statuses.push(s));
    ctl.onCursor({ t: 200, mode: "historical" }, true);
    flushRaf();
    await settleVerify();
    expect(statuses.at(-1)!.domMismatch).toBeUndefined();
    ctl.dispose();
  });

  it("names the attributes that disagree with the capture", async () => {
    // The signal the report was missing: React state restored, paint did not.
    const store = storeWithDom();
    const api = {
      ...fakeApi(),
      snapshotPage: () => ({
        root: {
          nodeName: "DIV",
          children: [{ nodeName: "SPAN", attributes: { class: "sw blue" } }],
        },
      }),
    };
    const statuses: Array<RestoreStatus | null> = [];
    const ctl = createPanelTimeTravel(store, api, (s) => statuses.push(s));
    ctl.onCursor({ t: 200, mode: "historical" }, true);
    flushRaf();
    await settleVerify();
    const mismatch = statuses.at(-1)!.domMismatch;
    expect(mismatch?.count).toBe(1);
    expect(mismatch?.examples.join(" ")).toContain("class");
    ctl.dispose();
  });

  it("stays silent when no capture is close enough to the cursor to be evidence", async () => {
    // Commit DOM is throttled, so a distant snapshot proves nothing.
    const store = storeWithDom();
    const api = {
      ...fakeApi(),
      snapshotPage: () => ({ root: { nodeName: "DIV" } }),
    };
    const statuses: Array<RestoreStatus | null> = [];
    const ctl = createPanelTimeTravel(store, api, (s) => statuses.push(s));
    ctl.onCursor({ t: 5_000, mode: "historical" }, true);
    flushRaf();
    await settleVerify();
    expect(statuses.at(-1)!.domMismatch).toBeUndefined();
    ctl.dispose();
  });

  it("skips verification entirely when the page cannot snapshot", async () => {
    const ctl = createPanelTimeTravel(storeWithDom(), fakeApi(), () => {});
    ctl.onCursor({ t: 200, mode: "historical" }, true);
    flushRaf();
    await settle();
    ctl.dispose(); // must not throw when snapshotPage is absent
  });
});

describe("createPanelTimeTravel — restore status", () => {
  it("publishes applied count and per-component failures", async () => {
    const api = fakeApi((entries) =>
      result({
        applied: entries.length - 1,
        failed: 1,
        failures: [{ componentId: cid(2), renderId: rid(11), reason: "no-history" }],
      }),
    );
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
        ? result({
            failed: entries.length,
            failures: entries.map((e) => ({ ...e, reason: "no-history" as const })),
          })
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

  it("sends the panel's snap setting with every apply", async () => {
    const applies: Array<{ snap?: boolean } | undefined> = [];
    const api = fakeApi(() => result());
    const wrapped: typeof api = {
      ...api,
      apply(entries, atT, options) {
        applies.push(options);
        return api.apply(entries, atT, options);
      },
    };
    const ctl = createPanelTimeTravel(makeStore(), wrapped);
    ctl.onCursor({ t: 250, mode: "historical" }, true);
    flushRaf();
    await settle();
    expect(applies.at(-1)).toEqual({ snap: true });

    ctl.setSnap(false);
    ctl.onCursor({ t: 120, mode: "historical" }, true);
    flushRaf();
    await settle();
    expect(applies.at(-1)).toEqual({ snap: false });
    ctl.dispose();
  });

  it("carries store restores and names each unavailable store", async () => {
    const api = fakeApi(() =>
      result({
        applied: 1,
        storesApplied: 1,
        storeFailures: [{ storeId: "cart", reason: "no-snapshot" }],
      }),
    );
    const statuses: Array<RestoreStatus | null> = [];
    const ctl = createPanelTimeTravel(makeStore(), api, (s) => statuses.push(s));
    ctl.onCursor({ t: 250, mode: "historical" }, true);
    flushRaf();
    await settle();
    const last = statuses.at(-1)!;
    expect(last.storesApplied).toBe(1);
    expect(last.storeFailures.get("cart")).toBe("no-snapshot");
    ctl.dispose();
  });

  it("drops a store failure once a later cursor restores that store", async () => {
    // Store state is whole-app, not per delta: the newest apply is the truth,
    // unlike component failures which accumulate across deltas.
    let broken = true;
    const api = fakeApi(() =>
      broken
        ? result({ storeFailures: [{ storeId: "cart", reason: "no-snapshot" }] })
        : result({ storesApplied: 1 }),
    );
    const statuses: Array<RestoreStatus | null> = [];
    const ctl = createPanelTimeTravel(makeStore(), api, (s) => statuses.push(s));
    ctl.onCursor({ t: 120, mode: "historical" }, true);
    flushRaf();
    await settle();
    expect(statuses.at(-1)!.storeFailures.size).toBe(1);

    broken = false;
    ctl.onCursor({ t: 250, mode: "historical" }, true);
    flushRaf();
    await settle();
    const last = statuses.at(-1)!;
    expect(last.storeFailures.size).toBe(0);
    expect(last.storesApplied).toBe(1);
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

    resolveFirst(
      result({
        failed: 1,
        failures: [{ componentId: cid(1), renderId: rid(10), reason: "write-failed" }],
      }),
    );
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

  it("does not apply a queued restore after goLive (replay End race)", async () => {
    const api = fakeApi();
    const ctl = createPanelTimeTravel(makeStore(), api);
    ctl.onCursor({ t: 100, mode: "historical" }, true);
    flushRaf();
    // goLive before the flush's microtasked apply runs — End during reverse play.
    ctl.goLive();
    await settle();
    expect(api.goLives).toBe(1);
    expect(api.applies).toHaveLength(0);
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
