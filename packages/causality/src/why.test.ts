import { describe, it, expect } from "vite-plus/test";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "./why.js";
import type {
  RenderEvent,
  RenderReason,
  ComponentId,
  RenderId,
  CommitId,
  EventId,
  ComponentInstance,
  RenderSnapshot,
  SerializedValue,
} from "@reactlens/protocol";

let seq = 0;
const CID = 1 as ComponentId;

function render(renderId: number, reasons: RenderReason[]): RenderEvent {
  return {
    id: ++seq as EventId,
    type: "render",
    timestamp: renderId,
    renderId: renderId as RenderId,
    commitId: 1 as CommitId,
    componentId: CID,
    selfDuration: 1,
    totalDuration: 1,
    reasons,
    compiler: { compiled: true, memoized: true },
  };
}

function instance(id: number, name: string): ComponentInstance {
  return {
    id: id as ComponentId,
    type: id as never,
    name,
    rootId: 1 as never,
    compiler: { compiled: true, memoized: true },
  };
}

const obj = (identity: string, entries: Array<[string, SerializedValue]>): SerializedValue => ({
  k: "object",
  identity,
  entries,
});
const fn = (identity: string, name: string): SerializedValue => ({ k: "function", identity, name });
const domNode = (over: { text?: string; attrs?: Record<string, string> }) => ({
  root: {
    nodeName: "BUTTON",
    attributes: over.attrs ?? { class: "b" },
    text: over.text ?? "Add",
  },
});

function snap(renderId: number, over: Partial<RenderSnapshot>): RenderSnapshot {
  return {
    renderId: renderId as RenderId,
    componentId: CID,
    timestamp: renderId,
    props: { k: "undefined" },
    ...over,
  };
}

describe("causality — why did this render?", () => {
  it("explains a mount as expected", () => {
    const store = new TraceStore();
    store.ingest({ events: [render(1, [{ type: "mount" }])], snapshots: [], instances: [] });
    const why = createCausality(store).why(1 as RenderId);
    expect(why.verdict).toBe("expected");
    expect(why.causes[0]?.level).toBe(1);
    expect(why.causes[0]?.explanation).toMatch(/Mounted/);
  });

  it("names the parent that re-rendered", () => {
    const store = new TraceStore();
    store.ingest({
      events: [
        render(1, [{ type: "mount" }]),
        render(2, [{ type: "parent", componentId: 2 as ComponentId }]),
      ],
      snapshots: [],
      instances: [instance(2, "ProductGrid")],
    });
    const cause = createCausality(store).rootCause(2 as RenderId);
    expect(cause?.explanation).toBe("Parent ProductGrid re-rendered.");
  });

  it("flags a function-identity-only prop change with no observable output", () => {
    const store = new TraceStore();
    const before = obj("p1", [
      ["onClick", fn("fn_1", "onClick")],
      ["title", { k: "primitive", type: "string", value: "M" }],
    ]);
    const after = obj("p2", [
      ["onClick", fn("fn_2", "onClick")],
      ["title", { k: "primitive", type: "string", value: "M" }],
    ]);
    store.ingest({
      events: [
        render(1, [{ type: "mount" }]),
        render(2, [
          { type: "parent", componentId: 2 as ComponentId },
          { type: "props", changed: ["onClick"] },
        ]),
      ],
      snapshots: [
        snap(1, { props: before, dom: domNode({}) }),
        snap(2, { props: after, dom: domNode({}) }),
      ],
      instances: [instance(2, "ProductGrid")],
    });
    const why = createCausality(store).why(2 as RenderId);
    expect(why.observableOutputChanged).toBe(false);
    expect(why.verdict).toBe("no-observable-change");
    // props cause outranks the parent cause
    const root = why.causes[0];
    expect(root?.explanation).toMatch(/new function identity/);
    expect(root?.confidence).toBeLessThan(1);
  });

  it("treats a state change with DOM change as expected", () => {
    const store = new TraceStore();
    store.ingest({
      events: [render(1, [{ type: "mount" }]), render(2, [{ type: "state", hookIndex: 0 }])],
      snapshots: [
        snap(1, { dom: domNode({ text: "Add" }) }),
        snap(2, { dom: domNode({ text: "Remove" }) }),
      ],
      instances: [],
    });
    const why = createCausality(store).why(2 as RenderId);
    expect(why.observableOutputChanged).toBe(true);
    expect(why.verdict).toBe("expected");
    expect(why.causes[0]?.explanation).toMatch(/State \(hook #0\)/);
  });

  it("returns unknown verdict when DOM is not captured", () => {
    const store = new TraceStore();
    store.ingest({
      events: [
        render(1, [{ type: "mount" }]),
        render(2, [{ type: "parent", componentId: 9 as ComponentId }]),
      ],
      snapshots: [snap(1, {}), snap(2, {})],
      instances: [],
    });
    const why = createCausality(store).why(2 as RenderId);
    expect(why.verdict).toBe("unknown");
  });
});
