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

describe("why — enriched with diff evidence and cause source", () => {
  function functionChurnStore(): TraceStore {
    const store = new TraceStore();
    const propsOf = (identity: string, fnId: string): SerializedValue => ({
      k: "object",
      identity,
      entries: [["onSelect", fn(fnId)]],
    });
    store.ingest(
      batch({
        instances: [
          instance(1, "ProductCard", { parentId: cid(2) }),
          instance(2, "ProductList", {
            source: { file: "src/ProductList.tsx", line: 61, column: 4 },
          }),
        ],
        events: [
          renderEvent({ renderId: rid(1), componentId: cid(1) }),
          renderEvent({
            renderId: rid(2),
            componentId: cid(1),
            reasons: [
              { type: "props", changed: ["onSelect"] },
              { type: "parent", componentId: cid(2) },
            ],
          }),
        ],
        snapshots: [
          { renderId: rid(1), componentId: cid(1), timestamp: 1, props: propsOf("o1", "f1") },
          { renderId: rid(2), componentId: cid(1), timestamp: 2, props: propsOf("o2", "f2") },
        ],
      }),
    );
    return store;
  }

  it("carries diff summary, top changes, cause source, and compiler flags", async () => {
    const handlers = makeHandlers(functionChurnStore());
    const out = (await handlers.why({ renderId: 2 })) as {
      componentName: string;
      verdict: string;
      observableOutputChanged: boolean;
      compiler?: { compiled: boolean };
      causes: Array<{
        explanation: string;
        diffSummary?: { changed: number; referenceOnly: number };
        topChanges?: Array<{ path: string; kind: string }>;
        source?: { file: string; line: number };
      }>;
    };
    expect(out.componentName).toBe("ProductCard");
    expect(typeof out.observableOutputChanged).toBe("boolean");
    expect(out.compiler?.compiled).toBe(true);
    // Props cause (priority 1) leads and carries machine-readable evidence.
    const propsCause = out.causes.find((c) => /onSelect/.test(c.explanation));
    expect(propsCause?.topChanges?.some((c) => c.kind === "FUNCTION_IDENTITY_CHANGED")).toBe(true);
    expect(propsCause?.diffSummary).toBeDefined();
    // Parent cause points at the parent's source — the file to fix.
    const parentCause = out.causes.find((c) => /ProductList/.test(c.explanation));
    expect(parentCause?.source).toMatchObject({ file: "src/ProductList.tsx", line: 61 });
  });

  it("rejects an unknown renderId with a recovery hint instead of guessing", async () => {
    const handlers = makeHandlers(new TraceStore());
    const out = (await handlers.why({ renderId: 999 })) as { error?: string };
    expect(out.error).toMatch(/renderId/);
  });
});

describe("find_component / component_renders", () => {
  function shopStore(): TraceStore {
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [instance(1, "ProductCard"), instance(2, "ProductList"), instance(3, "Cart")],
        events: [
          renderEvent({ renderId: rid(1), componentId: cid(1), selfDuration: 2 }),
          renderEvent({ renderId: rid(2), componentId: cid(1), selfDuration: 9 }),
          renderEvent({ renderId: rid(3), componentId: cid(2), selfDuration: 4 }),
        ],
      }),
    );
    return store;
  }

  it("finds components by case-insensitive substring with render stats", async () => {
    const handlers = makeHandlers(shopStore());
    const out = (await handlers.find_component({ name: "product" })) as {
      matches: Array<{ componentId: number; name: string; renders: number; totalSelf: number }>;
    };
    expect(out.matches.map((m) => m.name).sort()).toEqual(["ProductCard", "ProductList"]);
    const card = out.matches.find((m) => m.name === "ProductCard");
    expect(card).toMatchObject({ renders: 2, totalSelf: 11 });
  });

  it("lists a component's renders sorted by self time with reasons", async () => {
    const handlers = makeHandlers(shopStore());
    const out = (await handlers.component_renders({ componentId: 1 })) as {
      renders: Array<{ renderId: number; self: number; reasons: string[] }>;
    };
    expect(out.renders[0]).toMatchObject({ renderId: 2, self: 9 });
    expect(out.renders[1]).toMatchObject({ renderId: 1, self: 2 });
    expect(out.renders[0]!.reasons).toContain("mount");
  });
});

describe("read_component_source", () => {
  const FILE = [
    'import { x } from "./x";',
    "",
    "export function Header() {",
    "  return null;",
    "}",
    "",
    "export function ProductList({ items }: { items: string[] }) {",
    "  return items.map((it) => (",
    "    <ProductCard key={it} onSelect={() => pick(it)} />",
    "  ));",
    "}",
  ].join("\n");

  function fakeResolver() {
    return {
      resolve: async () => ({ file: "src/ProductList.tsx", line: 7, column: 0 }),
      sourceContent: async () => ({ path: "src/ProductList.tsx", content: FILE }),
    };
  }

  it("returns a line-numbered snippet scoped to the component definition", async () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [
          instance(1, "ProductList", {
            source: { file: "http://app/assets/x.js", line: 40, column: 2 },
          }),
        ],
        events: [renderEvent({ renderId: rid(1), componentId: cid(1) })],
      }),
    );
    const handlers = createToolHandlers({
      store,
      causality: createCausality(store),
      diagnose: () => [],
      sourceResolver: fakeResolver() as never,
    });
    const out = (await handlers.read_component_source({ componentId: 1 })) as {
      name: string;
      file: string | null;
      span?: { startLine: number; endLine: number };
      snippet: string | null;
      truncated: boolean;
    };
    expect(out.file).toBe("src/ProductList.tsx");
    expect(out.span?.startLine).toBe(7);
    expect(out.snippet).toContain("7 | export function ProductList");
    expect(out.snippet).toContain("onSelect={() => pick(it)}");
    // Context lines include the file top here (small file), but never beyond it.
    expect(out.truncated).toBe(false);
  });

  it("degrades gracefully when the component has no source location", async () => {
    const store = new TraceStore();
    store.ingest(batch({ instances: [instance(1, "Mystery")] }));
    const handlers = makeHandlers(store);
    const out = (await handlers.read_component_source({ componentId: 1 })) as {
      snippet: string | null;
      reason?: string;
    };
    expect(out.snippet).toBeNull();
    expect(out.reason).toMatch(/source/i);
  });
});

describe("effects_summary", () => {
  it("aggregates run/cleanup stats and flags effects that run every render", async () => {
    const store = new TraceStore();
    const effect = (n: number, phase: "run" | "cleanup", duration: number): unknown => ({
      id: (900 + n) as EventId,
      type: "effect",
      timestamp: n,
      componentId: cid(1),
      effectId: n as never,
      phase,
      duration,
      hookIndex: 2,
    });
    store.ingest(
      batch({
        instances: [instance(1, "Feed")],
        events: [
          renderEvent({ renderId: rid(1), componentId: cid(1) }),
          renderEvent({ renderId: rid(2), componentId: cid(1) }),
          renderEvent({ renderId: rid(3), componentId: cid(1) }),
          renderEvent({ renderId: rid(4), componentId: cid(1) }),
          ...( [effect(1, "run", 4), effect(2, "run", 6), effect(3, "cleanup", 1), effect(4, "run", 2), effect(5, "run", 8)] as never[]),
        ],
      }),
    );
    const handlers = makeHandlers(store);
    const out = (await handlers.effects_summary({ componentId: 1 })) as {
      componentName: string;
      runs: number;
      cleanups: number;
      totalRunMs: number;
      possibleLoop: boolean;
      hooks: Array<{ hookIndex: number; runs: number; totalMs: number }>;
    };
    expect(out.componentName).toBe("Feed");
    expect(out.runs).toBe(4);
    expect(out.cleanups).toBe(1);
    expect(out.totalRunMs).toBe(20);
    // 4 recent renders, 4 runs → nearly one per render.
    expect(out.possibleLoop).toBe(true);
    expect(out.hooks[0]).toMatchObject({ hookIndex: 2, runs: 4, totalMs: 20 });
  });
});

describe("graph_neighbors", () => {
  it("returns parents and children by name", async () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [
          instance(1, "App"),
          instance(2, "List", { parentId: cid(1) }),
          instance(3, "Row", { parentId: cid(2) }),
        ],
        events: [renderEvent({ renderId: rid(1), componentId: cid(2) })],
      }),
    );
    const handlers = makeHandlers(store);
    const out = (await handlers.graph_neighbors({ componentId: 2 })) as {
      componentName: string;
      parents: Array<{ componentId: number; name: string }>;
      children: Array<{ componentId: number; name: string }>;
    };
    expect(out.componentName).toBe("List");
    expect(out.parents[0]).toMatchObject({ name: "App" });
    expect(out.children[0]).toMatchObject({ name: "Row" });
  });
});
