import { describe, it, expect } from "vite-plus/test";
import { buildInteractions, interactionKindLabel } from "./interactions.js";
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

const NAMES: Record<number, string> = {
  7: "Clock",
  8: "Badge",
  9: "Ticker",
  42: "ProductCard",
};
const nameOf = (id: ComponentId) => NAMES[id as unknown as number];

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
      interaction({
        timestamp: 10,
        interactionId: iid,
        kind: "click",
        target: { selector: ".card", componentId: 42 as ComponentId },
      }),
      render({ timestamp: 11, interactionId: iid, reasons: [{ type: "state", hookIndex: 0 }] }),
      render({ timestamp: 12, interactionId: iid }),
    ];
    const result = buildInteractions(events, nameOf);
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe("Click ProductCard");
    expect(result[0]!.metrics.renderCount).toBe(2);
    expect(result[0]!.metrics.stateUpdates).toBe(1);
  });

  it("attaches a close untagged render to the preceding interaction, but a distant one becomes a system bucket", () => {
    const iid = 200 as InteractionId;
    const events: LensEvent[] = [
      interaction({ timestamp: 100, interactionId: iid, kind: "click" }),
      render({ timestamp: 101, interactionId: iid }),
      render({ timestamp: 150, interactionId: undefined }), // within 300ms tail → attaches
      render({ timestamp: 900, interactionId: undefined }), // far later → system
    ];
    const result = buildInteractions(events, nameOf);
    const click = result.find((r) => r.kind === "click")!;
    const background = result.find((r) => r.kind === "system");
    expect(click.metrics.renderCount).toBe(2);
    expect(background).toBeDefined();
    expect(background!.label).toBe("Background");
    expect(interactionKindLabel(background!)).toBe("background");
    expect(background!.metrics.renderCount).toBe(1);
  });

  it("names a system bucket after the initiating component, not cascaded children", () => {
    const events: LensEvent[] = [
      render({
        timestamp: 1000,
        componentId: 7 as ComponentId,
        reasons: [{ type: "state", hookIndex: 0 }],
      }),
      render({
        timestamp: 1001,
        componentId: 8 as ComponentId,
        reasons: [{ type: "parent", componentId: 7 as ComponentId }],
      }),
    ];
    const result = buildInteractions(events, nameOf);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe("load");
    expect(result[0]!.label).toBe("Load");

    const later: LensEvent[] = [
      interaction({ timestamp: 10, interactionId: 1 as InteractionId, kind: "click" }),
      render({ timestamp: 11, interactionId: 1 as InteractionId }),
      render({
        timestamp: 900,
        componentId: 7 as ComponentId,
        reasons: [{ type: "state", hookIndex: 0 }],
      }),
      render({
        timestamp: 901,
        componentId: 8 as ComponentId,
        reasons: [{ type: "parent", componentId: 7 as ComponentId }],
      }),
    ];
    const named = buildInteractions(later, nameOf).find((r) => r.kind === "system");
    expect(named?.label).toBe("Clock");
    expect(named?.metrics.trigger).toBe("state");
    expect(interactionKindLabel(named!)).toBe("state");
    expect(named?.metrics.renderCount).toBe(2);
  });

  it("joins two initiator names and summarizes three or more", () => {
    const two: LensEvent[] = [
      interaction({ timestamp: 10, interactionId: 1 as InteractionId, kind: "click" }),
      render({ timestamp: 11, interactionId: 1 as InteractionId }),
      render({
        timestamp: 900,
        componentId: 7 as ComponentId,
        reasons: [{ type: "state", hookIndex: 0 }],
      }),
      render({
        timestamp: 910,
        componentId: 8 as ComponentId,
        reasons: [{ type: "state", hookIndex: 0 }],
      }),
    ];
    expect(buildInteractions(two, nameOf).find((r) => r.kind === "system")?.label).toBe(
      "Clock + Badge",
    );

    const three: LensEvent[] = [
      interaction({ timestamp: 10, interactionId: 1 as InteractionId, kind: "click" }),
      render({ timestamp: 11, interactionId: 1 as InteractionId }),
      render({
        timestamp: 900,
        componentId: 7 as ComponentId,
        reasons: [{ type: "state", hookIndex: 0 }],
      }),
      render({
        timestamp: 910,
        componentId: 8 as ComponentId,
        reasons: [{ type: "state", hookIndex: 0 }],
      }),
      render({
        timestamp: 920,
        componentId: 9 as ComponentId,
        reasons: [{ type: "state", hookIndex: 0 }],
      }),
    ];
    expect(buildInteractions(three, nameOf).find((r) => r.kind === "system")?.label).toBe(
      "Clock + 2 more",
    );
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

  it("sums exclusive self-time even when every render shares a commit timestamp", () => {
    const iid = 300 as InteractionId;
    const events: LensEvent[] = [
      interaction({ timestamp: 10, interactionId: iid, kind: "click" }),
      render({ timestamp: 10, interactionId: iid, selfDuration: 3 }),
      render({ timestamp: 10, interactionId: iid, selfDuration: 5 }),
    ];
    const click = buildInteractions(events, nameOf).find((r) => r.kind === "click")!;
    expect(click.metrics.reactDuration).toBe(8);
    // wall is last timestamp+self minus interaction start — not the CPU sum
    expect(click.metrics.totalDuration).toBe(5);
    expect(click.metrics.totalDuration).toBeLessThan(click.metrics.reactDuration);
  });
});
