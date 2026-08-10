import { describe, it, expect } from "vitest";
import { TraceStore } from "@react-lens/trace-engine";
import { createCausality } from "@react-lens/causality";
import { createSourceResolver } from "@react-lens/source-maps";
import { createToolHandlers } from "./handlers.js";
import type {
  RenderEvent,
  RenderSnapshot,
  HookSnapshot,
  SerializedValue,
  ComponentId,
  RenderId,
  CommitId,
  EventId,
  ComponentInstance,
  EventsBatchMessage,
} from "@react-lens/protocol";

let seq = 0;
const cid = (n: number) => n as ComponentId;
const rid = (n: number) => n as RenderId;

const str = (value: string): SerializedValue => ({ k: "primitive", type: "string", value });
const num = (value: number): SerializedValue => ({ k: "primitive", type: "number", value });
const fn = (identity: string): SerializedValue => ({ k: "function", identity, name: "onSelect" });

function renderEvent(over: Partial<RenderEvent> = {}): RenderEvent {
  seq++;
  return {
    id: seq as EventId,
    type: "render",
    timestamp: seq * 100,
    renderId: seq as RenderId,
    commitId: seq as CommitId,
    componentId: cid(1),
    selfDuration: 1,
    totalDuration: 1,
    reasons: [{ type: "mount" }],
    compiler: { compiled: true, memoized: true },
    ...over,
  };
}

function instance(id: number, name: string, over: Partial<ComponentInstance> = {}): ComponentInstance {
  return {
    id: cid(id),
    type: id as never,
    name,
    rootId: 1 as never,
    compiler: { compiled: true, memoized: true },
    ...over,
  };
}

function batch(over: Partial<EventsBatchMessage["payload"]> = {}): EventsBatchMessage["payload"] {
  return { events: [], snapshots: [], instances: [], ...over };
}

function makeHandlers(store: TraceStore) {
  return createToolHandlers({
    store,
    causality: createCausality(store),
    diagnose: () => [],
    sourceResolver: createSourceResolver(async () => {
      throw new Error("no fetch");
    }),
  });
}

function snapshotWithHooks(renderId: number, hooks: HookSnapshot[]): RenderSnapshot {
  return {
    renderId: rid(renderId),
    componentId: cid(1),
    timestamp: renderId,
    props: { k: "undefined" },
    hooks,
  };
}

describe("diff_snapshots kind:hooks", () => {
  it("compares hooks by index instead of feeding HookSnapshot[] to the value differ", async () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [instance(1, "Cart")],
        events: [renderEvent({ renderId: rid(1) }), renderEvent({ renderId: rid(2) })],
        snapshots: [
          snapshotWithHooks(1, [
            { index: 0, kind: "state", value: num(1) },
            { index: 1, kind: "memo", value: str("a"), deps: [num(1)] },
            { index: 2, kind: "ref", value: str("stable") },
          ]),
          snapshotWithHooks(2, [
            { index: 0, kind: "state", value: num(2) },              // value changed
            { index: 1, kind: "memo", value: str("a"), deps: [num(2)] }, // deps changed
            { index: 2, kind: "ref", value: str("stable") },         // unchanged
          ]),
        ],
      }),
    );
    const handlers = makeHandlers(store);
    const out = (await handlers.diff_snapshots({
      kind: "hooks",
      beforeRenderId: 1,
      afterRenderId: 2,
    })) as {
      kind: string;
      hooks: Array<{ index: number; hookKind: string; valueChanged: boolean; depsChanged: boolean }>;
      changeCount: number;
    };
    expect(out.kind).toBe("hooks");
    expect(out.hooks).toEqual([
      { index: 0, hookKind: "state", valueChanged: true, depsChanged: false },
      { index: 1, hookKind: "memo", valueChanged: false, depsChanged: true },
      { index: 2, hookKind: "ref", valueChanged: false, depsChanged: false },
    ]);
    expect(out.changeCount).toBe(2);
  });

  it("still value-diffs props with a typed changes list", async () => {
    const store = new TraceStore();
    // A fresh props object each render (new identity), carrying a fresh
    // function identity for onSelect — the classic inline-arrow signature.
    const props = (identity: string, v: SerializedValue): SerializedValue => ({
      k: "object",
      identity,
      entries: [["onSelect", v]],
    });
    store.ingest(
      batch({
        instances: [instance(1, "Row")],
        events: [renderEvent({ renderId: rid(1) }), renderEvent({ renderId: rid(2) })],
        snapshots: [
          { renderId: rid(1), componentId: cid(1), timestamp: 1, props: props("o1", fn("f1")) },
          { renderId: rid(2), componentId: cid(1), timestamp: 2, props: props("o2", fn("f2")) },
        ],
      }),
    );
    const handlers = makeHandlers(store);
    const out = (await handlers.diff_snapshots({
      kind: "props",
      beforeRenderId: 1,
      afterRenderId: 2,
    })) as { changes: Array<{ path: Array<string | number>; kind: string }> };
    expect(out.changes.some((c) => c.kind === "FUNCTION_IDENTITY_CHANGED")).toBe(true);
  });

  it("reports missing snapshots as a recoverable error", async () => {
    const handlers = makeHandlers(new TraceStore());
    const out = (await handlers.diff_snapshots({
      kind: "hooks",
      beforeRenderId: 1,
      afterRenderId: 2,
    })) as { error?: string };
    expect(out.error).toMatch(/missing snapshot/);
  });
});
