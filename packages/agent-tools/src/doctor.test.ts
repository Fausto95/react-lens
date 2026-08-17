import { describe, it, expect } from "vite-plus/test";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import type {
  ComponentId,
  ComponentInstance,
  CommitId,
  EffectEvent,
  EventId,
  EventsBatchMessage,
  RenderEvent,
  RenderId,
  SerializedValue,
} from "@reactlens/protocol";
import { buildDiagnosticInput, diagnoseAll, diagnoseOne } from "./doctor.js";

let seq = 0;
const cid = (n: number) => n as ComponentId;
const rid = (n: number) => n as RenderId;
const commit = (n: number) => n as CommitId;

const num = (value: number): SerializedValue => ({ k: "primitive", type: "number", value });
const obj = (identity: string, entries: Array<[string, SerializedValue]>): SerializedValue => ({
  k: "object",
  identity,
  entries,
});

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

function instance(
  id: number,
  name: string,
  over: Partial<ComponentInstance> = {},
): ComponentInstance {
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

const sameDom = { root: { nodeName: "DIV", text: "same" } };

describe("buildDiagnosticInput — latest commit evidence", () => {
  it("flags a wasted last render from identical DOM, without a second internals hook", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [instance(1, "WasteItem")],
        events: [
          renderEvent({
            renderId: rid(1),
            commitId: commit(1),
            timestamp: 10,
            reasons: [{ type: "mount" }],
          }),
          renderEvent({
            renderId: rid(2),
            commitId: commit(2),
            timestamp: 20,
            reasons: [{ type: "parent", componentId: cid(9) }],
          }),
        ],
        snapshots: [
          {
            renderId: rid(1),
            componentId: cid(1),
            timestamp: 10,
            props: { k: "undefined" },
            dom: sameDom,
          },
          {
            renderId: rid(2),
            componentId: cid(1),
            timestamp: 20,
            props: { k: "undefined" },
            dom: sameDom,
          },
        ],
      }),
    );
    const input = buildDiagnosticInput(store, createCausality(store), cid(1));
    expect(input?.latest?.wasted).toBe(true);
    expect(input?.latest?.parentOnly).toBe(true);
    expect(
      diagnoseOne(store, createCausality(store), cid(1)).some((d) => d.ruleId === "wasted-render"),
    ).toBe(true);
  });

  it("omits latest evidence when the component did not render in the latest commit", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [instance(1, "Old"), instance(2, "New")],
        events: [
          renderEvent({
            renderId: rid(1),
            componentId: cid(1),
            commitId: commit(1),
            timestamp: 10,
          }),
          renderEvent({
            renderId: rid(2),
            componentId: cid(2),
            commitId: commit(2),
            timestamp: 20,
          }),
        ],
      }),
    );
    const old = buildDiagnosticInput(store, createCausality(store), cid(1));
    const fresh = buildDiagnosticInput(store, createCausality(store), cid(2));
    expect(old?.latest).toBeUndefined();
    expect(fresh?.latest).toBeDefined();
  });

  it("captures compiler bailout, store, and force-update reasons from the last render", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [instance(1, "Chart")],
        events: [
          renderEvent({
            renderId: rid(1),
            commitId: commit(1),
            reasons: [
              { type: "external-store" },
              { type: "force-update" },
              { type: "compiler-bailout", reason: "useRef mutated during render" },
            ],
            compiler: {
              compiled: true,
              memoized: false,
              bailoutReason: "useRef mutated during render",
            },
          }),
        ],
      }),
    );
    const latest = buildDiagnosticInput(store, createCausality(store), cid(1))?.latest;
    expect(latest?.compilerBailout).toBe("useRef mutated during render");
    expect(latest?.externalStore).toBe(true);
    expect(latest?.forceUpdate).toBe(true);
    const ids = diagnoseOne(store, createCausality(store), cid(1)).map((d) => d.ruleId);
    expect(ids).toEqual(
      expect.arrayContaining(["compiler-bailout", "external-store", "force-update"]),
    );
  });

  it("counts same-commit descendants as cascade size", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [
          instance(1, "App"),
          instance(2, "List", { parentId: cid(1) }),
          instance(3, "Row", { parentId: cid(2) }),
        ],
        events: [
          renderEvent({
            renderId: rid(1),
            componentId: cid(1),
            commitId: commit(10),
            timestamp: 10,
            reasons: [{ type: "state", hookIndex: 0 }],
          }),
          renderEvent({
            renderId: rid(2),
            componentId: cid(2),
            commitId: commit(10),
            timestamp: 11,
            reasons: [{ type: "parent", componentId: cid(1) }],
          }),
          renderEvent({
            renderId: rid(3),
            componentId: cid(3),
            commitId: commit(10),
            timestamp: 12,
            reasons: [{ type: "parent", componentId: cid(2) }],
          }),
        ],
      }),
    );
    const app = buildDiagnosticInput(store, createCausality(store), cid(1));
    const list = buildDiagnosticInput(store, createCausality(store), cid(2));
    expect(app?.latest?.cascadeSize).toBe(2);
    expect(list?.latest?.cascadeSize).toBe(1);
    expect(list?.latest?.parentOnly).toBe(true);
  });

  it("detects identity-only object props on the last render", () => {
    const store = new TraceStore();
    const items = (identity: string): SerializedValue => obj(identity, [["n", num(1)]]);
    const props = (identity: string): SerializedValue =>
      obj("p-" + identity, [["items", items(identity)]]);
    store.ingest(
      batch({
        instances: [instance(1, "Grid")],
        events: [
          renderEvent({
            renderId: rid(1),
            commitId: commit(1),
            timestamp: 10,
            reasons: [{ type: "mount" }],
          }),
          renderEvent({
            renderId: rid(2),
            commitId: commit(2),
            timestamp: 20,
            reasons: [{ type: "props", changed: ["items"] }],
          }),
        ],
        snapshots: [
          {
            renderId: rid(1),
            componentId: cid(1),
            timestamp: 10,
            props: props("a1"),
          },
          {
            renderId: rid(2),
            componentId: cid(1),
            timestamp: 20,
            props: props("a2"),
          },
        ],
      }),
    );
    const latest = buildDiagnosticInput(store, createCausality(store), cid(1))?.latest;
    expect(latest?.identityKeys).toContain("items");
    expect(
      diagnoseOne(store, createCausality(store), cid(1)).some((d) => d.ruleId === "identity-churn"),
    ).toBe(true);
  });

  it("attributes effect cost in the last render's window", () => {
    const store = new TraceStore();
    const effect = (timestamp: number, duration: number): EffectEvent => ({
      id: (800 + timestamp) as EventId,
      type: "effect",
      timestamp,
      componentId: cid(1),
      effectId: timestamp as never,
      phase: "run",
      duration,
      hookIndex: 2,
    });
    store.ingest(
      batch({
        instances: [instance(1, "Feed")],
        events: [
          renderEvent({
            renderId: rid(1),
            commitId: commit(1),
            timestamp: 1000,
            selfDuration: 0.4,
            totalDuration: 0.4,
            reasons: [{ type: "state", hookIndex: 0 }],
          }),
          effect(1001, 6),
        ],
      }),
    );
    const latest = buildDiagnosticInput(store, createCausality(store), cid(1))?.latest;
    expect(latest?.effectMs).toBe(6);
    expect(latest?.effectLines[0]).toMatch(/hook #2/);
    expect(
      diagnoseOne(store, createCausality(store), cid(1)).some((d) => d.ruleId === "effect-heavy"),
    ).toBe(true);
  });

  it("diagnoseAll ranks findings across the latest commit", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [instance(1, "App"), instance(2, "Child", { parentId: cid(1) })],
        events: [
          renderEvent({
            renderId: rid(1),
            componentId: cid(1),
            commitId: commit(1),
            timestamp: 10,
            reasons: [{ type: "force-update" }],
            selfDuration: 8,
          }),
          renderEvent({
            renderId: rid(2),
            componentId: cid(2),
            commitId: commit(1),
            timestamp: 11,
            reasons: [{ type: "parent", componentId: cid(1) }],
          }),
        ],
      }),
    );
    const { diagnostics, affected } = diagnoseAll(store, createCausality(store));
    expect(affected.has(cid(1))).toBe(true);
    expect(diagnostics.some((d) => d.ruleId === "force-update")).toBe(true);
    expect(diagnostics[0]!.impact).toBeGreaterThanOrEqual(diagnostics.at(-1)!.impact);
  });
});
