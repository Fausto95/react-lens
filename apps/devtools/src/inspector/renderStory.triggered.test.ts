import { describe, it, expect } from "vite-plus/test";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import type {
  CommitId,
  ComponentId,
  ComponentInstance,
  EventId,
  RenderEvent,
  RenderId,
} from "@reactlens/protocol";
import { typeLaneKey } from "../laneFilter.js";
import { buildRenderStory } from "./renderStory.js";

let seq = 0;
const inst = (id: number, name: string, parentId?: number): ComponentInstance => ({
  id: id as ComponentId,
  type: id as never,
  name,
  rootId: 1 as never,
  compiler: { compiled: false, memoized: false },
  ...(parentId !== undefined ? { parentId: parentId as ComponentId } : {}),
});

const render = (
  comp: number,
  rid: number,
  opts: { t?: number; self?: number; cause?: "state" | "parent" } = {},
): RenderEvent => ({
  id: ++seq as EventId,
  type: "render",
  timestamp: opts.t ?? 100,
  renderId: rid as RenderId,
  commitId: 1 as CommitId,
  componentId: comp as ComponentId,
  selfDuration: opts.self ?? 1,
  totalDuration: opts.self ?? 1,
  reasons: [
    opts.cause === "parent" ? { type: "parent" } : { type: "state", hookIndex: 0 },
  ] as RenderEvent["reasons"],
  compiler: { compiled: false, memoized: false },
});

/** App(1) → [Header(2), List(3)] → List → Row(4): one commit, one cascade. */
function cascadeStore() {
  const store = new TraceStore();
  store.ingest({
    instances: [inst(1, "App"), inst(2, "Header", 1), inst(3, "List", 1), inst(4, "Row", 3)],
    snapshots: [],
    events: [
      render(1, 10, { t: 100, self: 2 }),
      render(3, 12, { t: 103, self: 4, cause: "parent" }),
      render(2, 11, { t: 101, self: 3, cause: "parent" }),
      render(4, 13, { t: 104, self: 1, cause: "parent" }),
    ],
  });
  return store;
}

describe("render story triggered", () => {
  it("lists direct children in timestamp order with lane and cost", () => {
    const store = cascadeStore();
    const story = buildRenderStory(store, createCausality(store), 10 as RenderId)!;
    expect(story.triggered.entries).toEqual([
      {
        renderId: 11,
        componentId: 2,
        name: "Header",
        laneKey: typeLaneKey("Header"),
        cause: "cascade",
        selfMs: 3,
      },
      {
        renderId: 12,
        componentId: 3,
        name: "List",
        laneKey: typeLaneKey("List"),
        cause: "cascade",
        selfMs: 4,
      },
    ]);
    expect(story.triggered.triggeredTotal).toBe(2);
  });

  it("counts the grandchild in the cascade total but not the entries", () => {
    const store = cascadeStore();
    const story = buildRenderStory(store, createCausality(store), 10 as RenderId)!;
    expect(story.triggered.entries.map((e) => e.name)).not.toContain("Row");
    expect(story.triggered.cascadeTotal).toBe(3);
  });

  it("is empty for a leaf render", () => {
    const store = cascadeStore();
    const story = buildRenderStory(store, createCausality(store), 13 as RenderId)!;
    expect(story.triggered.entries).toEqual([]);
    expect(story.triggered.triggeredTotal).toBe(0);
    expect(story.triggered.cascadeTotal).toBe(0);
  });

  it("caps the entries while reporting the full direct count", () => {
    const store = new TraceStore();
    const instances = [inst(1, "App")];
    const events = [render(1, 10, { t: 100 })];
    for (let i = 0; i < 10; i++) {
      instances.push(inst(2 + i, `Child${i}`, 1));
      events.push(render(2 + i, 20 + i, { t: 101 + i, cause: "parent" }));
    }
    store.ingest({ instances, snapshots: [], events });
    const story = buildRenderStory(store, createCausality(store), 10 as RenderId)!;
    expect(story.triggered.entries).toHaveLength(8);
    expect(story.triggered.triggeredTotal).toBe(10);
    expect(story.triggered.entries[0]!.name).toBe("Child0");
  });
});
