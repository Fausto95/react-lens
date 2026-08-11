import { describe, it, expect } from "vitest";
import { buildInteractions } from "./interactions.js";
import type {
  LensEvent,
  RenderEvent,
  InteractionEvent,
  ComponentId,
  RenderId,
  CommitId,
  EventId,
  InteractionId,
} from "@reactlens/protocol";

let seq = 0;
function render(over: Partial<RenderEvent> = {}): RenderEvent {
  const n = ++seq;
  return {
    id: n as EventId,
    type: "render",
    timestamp: n,
    renderId: n as RenderId,
    commitId: 1 as CommitId,
    componentId: 1 as ComponentId,
    selfDuration: 1,
    totalDuration: 1,
    reasons: [{ type: "parent", componentId: 2 as ComponentId }],
    compiler: { compiled: true, memoized: true },
    ...over,
  };
}
function interaction(over: Partial<InteractionEvent> = {}): InteractionEvent {
  const n = ++seq;
  return {
    id: n as EventId,
    type: "interaction",
    timestamp: n,
    interactionId: n as InteractionId,
    kind: "click",
    ...over,
  };
}

const nameOf = (id: ComponentId) => (id === (42 as ComponentId) ? "ProductCard" : undefined);

describe("buildInteractions", () => {
  it("groups pre-interaction renders under a synthetic Load", () => {
    const events: LensEvent[] = [
      render({ timestamp: 1, componentId: 1 as ComponentId }),
      render({ timestamp: 2, componentId: 2 as ComponentId }),
    ];
    const result = buildInteractions(events, nameOf);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe("load");
    expect(result[0]!.label).toBe("Load");
    expect(result[0]!.metrics.renderCount).toBe(2);
    expect(result[0]!.metrics.componentIds).toHaveLength(2);
  });

  it("labels an interaction from its target and attributes tagged renders", () => {
    const iid = 100 as InteractionId;
    const events: LensEvent[] = [
      interaction({ timestamp: 10, interactionId: iid, kind: "click", target: { selector: ".card", componentId: 42 as ComponentId } }),
      render({ timestamp: 11, interactionId: iid, reasons: [{ type: "state", hookIndex: 0 }] }),
      render({ timestamp: 12, interactionId: iid }),
    ];
    const result = buildInteractions(events, nameOf);
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe("Click ProductCard");
    expect(result[0]!.metrics.renderCount).toBe(2);
    expect(result[0]!.metrics.stateUpdates).toBe(1);
  });

  it("attaches a close untagged render to the preceding interaction, but a distant one becomes Background", () => {
    const iid = 200 as InteractionId;
    const events: LensEvent[] = [
      interaction({ timestamp: 100, interactionId: iid, kind: "click" }),
      render({ timestamp: 101, interactionId: iid }),
      render({ timestamp: 150, interactionId: undefined }), // within 300ms tail → attaches
      render({ timestamp: 900, interactionId: undefined }), // far later → Background
    ];
    const result = buildInteractions(events, nameOf);
    const click = result.find((r) => r.kind === "click")!;
    const background = result.find((r) => r.kind === "system");
    expect(click.metrics.renderCount).toBe(2);
    expect(background).toBeDefined();
    expect(background!.label).toBe("Background");
    expect(background!.metrics.renderCount).toBe(1);
  });

  it("orders interactions by start time and spans to the last render end", () => {
    const events: LensEvent[] = [
      interaction({ timestamp: 50, interactionId: 1 as InteractionId, kind: "submit" }),
      render({ timestamp: 51, interactionId: 1 as InteractionId, selfDuration: 4 }),
      render({ timestamp: 5, componentId: 1 as ComponentId }), // pre-interaction → Load
    ];
    const result = buildInteractions(events, nameOf);
    expect(result.map((r) => r.kind)).toEqual(["load", "submit"]);
    const submit = result[1]!;
    expect(submit.label).toBe("Submit");
    expect(submit.end).toBe(55); // 51 + selfDuration 4
    expect(submit.metrics.totalDuration).toBe(5); // 55 - 50
  });
});
