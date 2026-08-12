import { describe, it, expect } from "vite-plus/test";
import { TraceStore } from "./trace-store.js";
import type {
  ComponentId,
  EventId,
  EventsBatchMessage,
  RenderEvent,
  RenderId,
  CommitId,
} from "@reactlens/protocol";

function render(n: number, componentId = 1): RenderEvent {
  return {
    id: n as EventId,
    type: "render",
    timestamp: n,
    renderId: n as RenderId,
    commitId: n as CommitId,
    componentId: componentId as ComponentId,
    selfDuration: 1,
    totalDuration: 1,
    reasons: [{ type: "mount" }],
    compiler: { compiled: true, memoized: true },
  };
}

function batch(events: RenderEvent[]): EventsBatchMessage["payload"] {
  return { events, snapshots: [], instances: [] };
}

describe("retention is reported, never silent", () => {
  it("counts events the ring had to evict", () => {
    // A user looking at a timeline that starts mid-session has no way to tell
    // whether the app was idle or whether the panel threw the beginning away.
    const store = new TraceStore({ maxEvents: 10 });
    for (let n = 1; n <= 25; n++) store.ingest(batch([render(n)]));

    expect(store.retention().droppedEvents).toBe(15);
    expect(store.retention().oldestRetainedAt).toBe(16);
  });

  it("reports nothing dropped while everything fits", () => {
    const store = new TraceStore({ maxEvents: 100 });
    for (let n = 1; n <= 25; n++) store.ingest(batch([render(n)]));

    expect(store.retention().droppedEvents).toBe(0);
  });

  it("counts what the age window trimmed", () => {
    const store = new TraceStore({ maxEvents: 1000, maxAgeMs: 5 });
    for (let n = 1; n <= 20; n++) store.ingest(batch([render(n)]));

    expect(store.retention().droppedEvents).toBeGreaterThan(0);
    expect(store.allEvents().length).toBeLessThan(20);
  });

  it("counts renders dropped from a single component's history", () => {
    // The per-component cap is the one users hit first, and it is what makes a
    // hot component's early renders disappear from the inspector.
    const store = new TraceStore({ maxEvents: 10_000, maxRendersPerComponent: 5 });
    for (let n = 1; n <= 12; n++) store.ingest(batch([render(n)]));

    expect(store.retention().droppedRenders).toBe(7);
    // The lifetime count still knows the truth, which is what makes the
    // discrepancy reportable at all.
    expect(store.renderCount(1 as ComponentId)).toBe(12);
  });

  it("forgets its retention losses when the session is cleared", () => {
    const store = new TraceStore({ maxEvents: 10 });
    for (let n = 1; n <= 25; n++) store.ingest(batch([render(n)]));
    store.clear();

    expect(store.retention()).toEqual({
      droppedEvents: 0,
      droppedRenders: 0,
      droppedSnapshots: 0,
      oldestRetainedAt: null,
    });
  });
});
