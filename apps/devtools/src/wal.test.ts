import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import type { EventsBatchMessage } from "@reactlens/protocol";
import { createTraceWal, WAL_FLUSH_MS, type WalRecord, type WalStore } from "./wal.js";

type Payload = EventsBatchMessage["payload"];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** One render event, so a recovered frame is identifiable. */
function frame(n: number): Payload {
  return {
    events: [
      {
        id: n as never,
        type: "render",
        timestamp: n,
        renderId: n as never,
        commitId: n as never,
        componentId: 1 as never,
        selfDuration: 1,
        totalDuration: 1,
        reasons: [{ type: "mount" }],
        compiler: { compiled: true, memoized: true },
      },
    ],
    snapshots: [],
    instances: [],
  };
}

const renderIdsIn = (frames: readonly Payload[]) =>
  frames.flatMap((f) => f.events.map((e) => e.timestamp));

function fakeStore(opts: { failWrites?: boolean } = {}) {
  const data = new Map<number, WalRecord>();
  const store: WalStore = {
    async put(id, record) {
      if (opts.failWrites) throw new Error("QuotaExceededError");
      data.set(id, record);
    },
    async all() {
      return [...data.entries()]
        .map(([id, record]) => ({ id, record }))
        .sort((a, b) => a.id - b.id);
    },
    async delete(ids) {
      for (const id of ids) data.delete(id);
    },
    async clear() {
      data.clear();
    },
  };
  return { store, data };
}

/** Let queued microtasks and the flush timer run. */
async function settle(wal: { flush(): Promise<void> }) {
  await vi.advanceTimersByTimeAsync(WAL_FLUSH_MS);
  await wal.flush();
}

describe("trace write-ahead log", () => {
  it("batches appends into one durable write", async () => {
    // An IDB round-trip per frame would throttle ingest on a busy app.
    const { store, data } = fakeStore();
    const wal = createTraceWal(store);
    for (let n = 1; n <= 20; n++) wal.append("doc-1", n, frame(n));
    expect(data.size).toBe(0);

    await settle(wal);
    expect(data.size).toBe(1);
    expect([...data.values()][0]!.frames).toHaveLength(20);
  });

  it("reports each seq durable only once it is actually written", async () => {
    const durable: number[] = [];
    const { store } = fakeStore();
    const wal = createTraceWal(store, { onDurable: (_s, seqs) => durable.push(...seqs) });
    wal.append("doc-1", 1, frame(1));
    wal.append("doc-1", 2, frame(2));
    expect(durable).toEqual([]);

    await settle(wal);
    expect(durable).toEqual([1, 2]);
  });

  it("reports a failed write so the caller can hold its cursor", async () => {
    // A frame that never reached disk must not be acked away page-side.
    const failed: number[] = [];
    const durable: number[] = [];
    const { store } = fakeStore({ failWrites: true });
    const wal = createTraceWal(store, {
      onDurable: (_s, seqs) => durable.push(...seqs),
      onFailed: (_s, seqs) => failed.push(...seqs),
    });
    wal.append("doc-1", 7, frame(7));

    await settle(wal);
    expect(durable).toEqual([]);
    expect(failed).toEqual([7]);
  });

  it("recovers the log as frames in order, with the cursor it reached", async () => {
    const { store } = fakeStore();
    const wal = createTraceWal(store);
    for (let n = 1; n <= 5; n++) wal.append("doc-1", n, frame(n));
    await settle(wal);

    const recovered = await createTraceWal(store).recover();
    expect(recovered?.sessionId).toBe("doc-1");
    expect(recovered?.lastSeq).toBe(5);
    expect(renderIdsIn(recovered!.frames)).toEqual([1, 2, 3, 4, 5]);
  });

  it("recovers nothing from an empty log", async () => {
    const { store } = fakeStore();
    expect(await createTraceWal(store).recover()).toBeNull();
  });

  it("forgets the previous document as soon as a new one appends", async () => {
    // The page reloaded: its id factories restarted, so the old log cannot be
    // replayed into the new session and must not be recovered into it either.
    const { store } = fakeStore();
    const wal = createTraceWal(store);
    for (let n = 1; n <= 3; n++) wal.append("doc-1", n, frame(n));
    await settle(wal);

    wal.append("doc-2", 1, frame(9));
    await settle(wal);

    const recovered = await createTraceWal(store).recover();
    expect(recovered?.sessionId).toBe("doc-2");
    expect(renderIdsIn(recovered!.frames)).toEqual([9]);
  });

  it("recovers only the newest session when the log holds two", async () => {
    // Belt and braces: a crash between the reset and the first write could
    // leave both behind.
    const { store, data } = fakeStore();
    data.set(1, { sessionId: "old", seqs: [4], frames: [frame(1)] });
    data.set(2, { sessionId: "new", seqs: [2], frames: [frame(2)] });

    const recovered = await createTraceWal(store).recover();
    expect(recovered?.sessionId).toBe("new");
    expect(renderIdsIn(recovered!.frames)).toEqual([2]);
    // ...and the stale session is swept, not left occupying the quota.
    expect([...data.values()].every((r) => r.sessionId === "new")).toBe(true);
  });

  it("drops the oldest frames when the log exceeds its budget, and says so", async () => {
    // Storage is finite. What matters is that the loss is named rather than
    // showing a session that quietly begins in the middle.
    const dropped: number[] = [];
    const { store } = fakeStore();
    const wal = createTraceWal(store, {
      maxFrames: 10,
      onDropped: (count) => dropped.push(count),
    });
    for (let n = 1; n <= 25; n++) {
      wal.append("doc-1", n, frame(n));
      await settle(wal);
    }

    const recovered = await createTraceWal(store).recover();
    expect(recovered!.frames.length).toBeLessThanOrEqual(10);
    expect(renderIdsIn(recovered!.frames).at(-1)).toBe(25);
    expect(dropped.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it("stops writing once closed", async () => {
    const { store, data } = fakeStore();
    const wal = createTraceWal(store);
    wal.close();
    wal.append("doc-1", 1, frame(1));
    await settle(wal);

    expect(data.size).toBe(0);
  });
});
