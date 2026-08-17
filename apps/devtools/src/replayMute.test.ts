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

function instance(id: number, name: string, parentId?: number): ComponentInstance {
  return {
    id: cid(id),
    type: id as never,
    name,
    rootId: 1 as never,
    ...(parentId === undefined ? {} : { parentId: cid(parentId) }),
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
        instance(2, "Analytics", 1),
        instance(3, "Player", 2),
        instance(4, "Player", 1),
        instance(5, "EffectChild", 3),
      ],
      events: [
        render(1, 10, 100),
        render(2, 11, 110),
        render(3, 12, 120),
        render(4, 13, 130),
        render(5, 14, 140),
      ],
    }),
  );
  return store;
}

function fullApplySet(): Map<ComponentId, RenderId> {
  return new Map([
    [cid(1), rid(10)],
    [cid(2), rid(11)],
    [cid(3), rid(12)],
    [cid(4), rid(13)],
    [cid(5), rid(14)],
  ]);
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
  it("mutes every matching type instance and each matching subtree", () => {
    const filter = toggleMute(EMPTY_LANE_FILTER, typeLaneKey("Player"));
    expect([...replayApplySet(makeStore(), fullApplySet(), filter).keys()]).toEqual([cid(1), cid(2)]);
  });

  it("mutes one instance subtree without suppressing its sibling", () => {
    const filter = toggleMute(EMPTY_LANE_FILTER, instanceLaneKey("Player", cid(3)));
    expect([...replayApplySet(makeStore(), fullApplySet(), filter).keys()]).toEqual([
      cid(1),
      cid(2),
      cid(4),
    ]);
  });

  it("makes a muted parent a replay boundary for all descendants", () => {
    const filter = toggleMute(EMPTY_LANE_FILTER, typeLaneKey("Analytics"));
    expect([...replayApplySet(makeStore(), fullApplySet(), filter).keys()]).toEqual([cid(1), cid(4)]);
  });

  it("does not treat solo as replay exclusion", () => {
    const filter = toggleSolo(EMPTY_LANE_FILTER, typeLaneKey("App"));
    expect([...replayApplySet(makeStore(), fullApplySet(), filter).keys()]).toEqual([
      cid(1), cid(2), cid(3), cid(4), cid(5),
    ]);
  });
});

describe("replay integration", () => {
  it("never sends a muted subtree through the page restore API", async () => {
    const store = makeStore();
    const api = fakeApi();
    const filter = toggleMute(EMPTY_LANE_FILTER, typeLaneKey("Analytics"));
    const ctl = createPanelTimeTravel(store, api, undefined, { getLaneFilter: () => filter });

    ctl.onCursor({ t: 200, mode: "historical" }, true);
    flushRaf();
    await settle();

    expect(api.applies).toHaveLength(1);
    expect(api.applies[0]!.map((entry) => entry.componentId)).toEqual([cid(1), cid(4)]);
    ctl.dispose();
  });

  it("reads mute policy at each playback flush", async () => {
    const store = makeStore();
    const api = fakeApi();
    let filter: LaneFilter = EMPTY_LANE_FILTER;
    const ctl = createPanelTimeTravel(store, api, undefined, { getLaneFilter: () => filter });

    filter = toggleMute(filter, typeLaneKey("Player"));
    ctl.onCursor({ t: 200, mode: "historical" }, true);
    flushRaf();
    await settle();

    expect(api.applies[0]!.map((entry) => entry.componentId)).toEqual([cid(1), cid(2)]);
    ctl.dispose();
  });
});
