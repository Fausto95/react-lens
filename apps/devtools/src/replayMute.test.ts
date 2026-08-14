import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { TraceStore } from "@reactlens/trace-engine";
import type {
  CommitId,
  ComponentId,
  ComponentInstance,
  EventId,
  EventsBatchMessage,
  RenderEvent,
  RenderId,
  TimeTravelEntry,
  TimeTravelResult,
} from "@reactlens/protocol";
import {
  EMPTY_LANE_FILTER,
  instanceLaneKey,
  toggleMute,
  toggleSolo,
  type LaneFilter,
  typeLaneKey,
} from "./laneFilter.js";
import {
  createPanelTimeTravel,
  replayApplySet,
  type TimeTravelApi,
} from "./timeTravelController.js";

const cid = (n: number) => n as ComponentId;
const rid = (n: number) => n as RenderId;

let eventSeq = 0;
function render(componentId: number, renderId: number, timestamp: number): RenderEvent {
  return {
    id: ++eventSeq as EventId,
    type: "render",
    timestamp,
    renderId: rid(renderId),
    commitId: 1 as CommitId,
    componentId: cid(componentId),
    selfDuration: 1,
    totalDuration: 1,
    reasons: [],
    compiler: { compiled: false, memoized: false },
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

function makeStore(): TraceStore {
  const store = new TraceStore();
  store.ingest(
    batch({
      instances: [
        instance(1, "App"),
        instance(2, "Analytics"),
        instance(3, "Player"),
        instance(4, "Player"),
      ],
      events: [
        render(1, 10, 100),
        render(2, 11, 110),
        render(3, 12, 120),
        render(4, 13, 130),
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

function fakeApi(): TimeTravelApi & { applies: TimeTravelEntry[][] } {
  const api = {
    applies: [] as TimeTravelEntry[][],
    supported: () => true,
    apply(entries: TimeTravelEntry[]) {
      api.applies.push(entries);
      return ok(entries);
    },
    goLive() {
      return { applied: 0, failed: 0, supported: true, failures: [] };
    },
  };
  return api;
}

let rafQueue: FrameRequestCallback[] = [];
function flushRaf(): void {
  const queue = rafQueue;
  rafQueue = [];
  for (const cb of queue) cb(0);
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  eventSeq = 0;
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => vi.unstubAllGlobals());

describe("replay apply policy", () => {
  it("removes every instance of a muted component type", () => {
    const store = makeStore();
    const raw = new Map<ComponentId, RenderId>([
      [cid(1), rid(10)],
      [cid(2), rid(11)],
      [cid(3), rid(12)],
      [cid(4), rid(13)],
    ]);
    const filter = toggleMute(EMPTY_LANE_FILTER, typeLaneKey("Player"));
    expect([...replayApplySet(store, raw, filter).keys()]).toEqual([cid(1), cid(2)]);
  });

  it("supports an instance mute without suppressing siblings", () => {
    const store = makeStore();
    const raw = new Map<ComponentId, RenderId>([
      [cid(3), rid(12)],
      [cid(4), rid(13)],
    ]);
    const filter = toggleMute(EMPTY_LANE_FILTER, instanceLaneKey("Player", cid(3)));
    expect([...replayApplySet(store, raw, filter).keys()]).toEqual([cid(4)]);
  });

  it("does not treat solo as replay exclusion", () => {
    const store = makeStore();
    const raw = new Map<ComponentId, RenderId>([
      [cid(1), rid(10)],
      [cid(2), rid(11)],
    ]);
    const filter = toggleSolo(EMPTY_LANE_FILTER, typeLaneKey("App"));
    expect([...replayApplySet(store, raw, filter).keys()]).toEqual([cid(1), cid(2)]);
  });
});

describe("replay integration", () => {
  it("never sends muted component state across the page API", async () => {
    const store = makeStore();
    const api = fakeApi();
    const filter = toggleMute(EMPTY_LANE_FILTER, typeLaneKey("Analytics"));
    const ctl = createPanelTimeTravel(store, api, undefined, {
      getLaneFilter: () => filter,
    });

    ctl.onCursor({ t: 200, mode: "historical" }, true);
    flushRaf();
    await settle();

    expect(api.applies).toHaveLength(1);
    expect(api.applies[0]!.some((entry) => entry.componentId === cid(2))).toBe(false);
    expect(api.applies[0]!.map((entry) => entry.componentId)).toEqual(
      expect.arrayContaining([cid(1), cid(3), cid(4)]),
    );
    ctl.dispose();
  });

  it("reads mute policy at each playback flush so changes do not recreate the controller", async () => {
    const store = makeStore();
    const api = fakeApi();
    let filter: LaneFilter = EMPTY_LANE_FILTER;
    const ctl = createPanelTimeTravel(store, api, undefined, {
      getLaneFilter: () => filter,
    });

    filter = toggleMute(filter, typeLaneKey("Player"));
    ctl.onCursor({ t: 200, mode: "historical" }, true);
    flushRaf();
    await settle();

    expect(api.applies[0]!.some((entry) => entry.componentId === cid(3))).toBe(false);
    expect(api.applies[0]!.some((entry) => entry.componentId === cid(4))).toBe(false);
    ctl.dispose();
  });
});
