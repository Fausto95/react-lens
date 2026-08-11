import { describe, it, expect } from "vite-plus/test";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
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
  InteractionId,
} from "@reactlens/protocol";
import type { Interaction } from "@reactlens/trace-engine";
import type { Diagnostic } from "@reactlens/diagnostics";
import { explainInteraction } from "./explain.js";

let seq = 0;
const CID = 1 as ComponentId;
const PARENT = 2 as ComponentId;

function render(
  renderId: number,
  reasons: RenderReason[],
  over: Partial<RenderEvent> = {},
): RenderEvent {
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
    interactionId: 1 as InteractionId,
    ...over,
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

function interactionOf(store: TraceStore, label = "Click"): Interaction {
  const renders = store.export().events.filter((e): e is RenderEvent => e.type === "render");
  return {
    id: "1",
    label,
    kind: "click",
    start: 0,
    end: 10,
    renderIds: renders.map((r) => r.renderId),
    commitIds: [1 as CommitId],
    metrics: {
      totalDuration: 8,
      reactDuration: 5,
      renderCount: renders.length,
      stateUpdates: 0,
      componentIds: [...new Set(renders.map((r) => r.componentId))],
    },
  };
}

describe("explainInteraction", () => {
  it("ranks cost, flags waste, and suggests a next click", () => {
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
        render(1, [{ type: "mount" }], { selfDuration: 0.2, componentId: CID }),
        render(
          2,
          [
            { type: "parent", componentId: PARENT },
            { type: "props", changed: ["onClick"] },
          ],
          { selfDuration: 4.5, componentId: CID },
        ),
        render(3, [{ type: "state", hookIndex: 0 }], {
          selfDuration: 1.2,
          componentId: PARENT,
        }),
      ],
      snapshots: [
        snap(1, { props: before, dom: domNode({}) }),
        snap(2, { componentId: CID, props: after, dom: domNode({}) }),
        {
          renderId: 3 as RenderId,
          componentId: PARENT,
          timestamp: 3,
          props: { k: "undefined" },
          dom: domNode({ text: "x" }),
        },
      ],
      instances: [instance(1, "ProductCard"), instance(2, "ProductGrid")],
    });

    const causality = createCausality(store);
    const diagnose = (id: ComponentId): Diagnostic[] =>
      id === CID
        ? [
            {
              ruleId: "unstable-callback",
              componentId: CID,
              severity: "suspicious",
              title: "Unstable callback prop",
              detail: "onClick identity churn",
              impact: 42,
              fix: "Stabilize the callback at the producer",
            },
          ]
        : [];

    const narrative = explainInteraction(store, causality, interactionOf(store), {
      diagnose,
    });

    expect(narrative.headline).toMatch(/ProductCard|avoidable/i);
    expect(narrative.topCost[0]?.name).toBe("ProductCard");
    expect(narrative.topCost[0]?.self).toBe(4.5);
    expect(narrative.waste.some((w) => w.name === "ProductCard")).toBe(true);
    expect(narrative.chain[0]?.explanation).toMatch(/function identity|Parent|props/i);
    expect(narrative.doctor[0]?.ruleId).toBe("unstable-callback");
    expect(narrative.nextClick?.kind).toBe("doctor");
    expect(narrative.nextClick?.reason).toMatch(/Stabilize the callback|Fix:/i);
    expect(narrative.citations.some((c) => c.kind === "component")).toBe(true);
    expect(narrative.summary).toMatch(/Avoidable:|no observable DOM change/i);
    expect(narrative.summary).toMatch(/Fix:/i);
  });

  it("falls back to costliest component when no waste or doctor", () => {
    const store = new TraceStore();
    store.ingest({
      events: [render(1, [{ type: "mount" }], { selfDuration: 2, componentId: CID })],
      snapshots: [snap(1, { dom: domNode({ text: "hi" }) })],
      instances: [instance(1, "App")],
    });
    const narrative = explainInteraction(
      store,
      createCausality(store),
      interactionOf(store, "Load"),
    );
    expect(narrative.headline).toMatch(/expected:.*App mount/i);
    expect(narrative.summary).toMatch(/Expected:|first-paint/i);
    expect(narrative.nextClick?.kind).toBe("component");
    expect(narrative.nextClick?.reason).toMatch(/App/);
  });
});
