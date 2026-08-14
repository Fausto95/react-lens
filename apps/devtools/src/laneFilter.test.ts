import { describe, it, expect } from "vite-plus/test";
import {
  EMPTY_LANE_FILTER,
  deserializeLaneFilter,
  instanceLaneKey,
  laneChain,
  laneVisibility,
  isLaneVisible,
  isComponentReplayMuted,
  parentLaneKey,
  serializeLaneFilter,
  toggleMute,
  toggleSolo,
  typeLaneKey,
  clearLaneFilter,
} from "./laneFilter.js";
import type { ComponentId } from "@reactlens/protocol";

const id = (n: number) => n as ComponentId;

describe("lane keys", () => {
  it("keys a lane by component type, not by instance id", () => {
    expect(typeLaneKey("CartBadge")).toBe(typeLaneKey("CartBadge"));
    expect(typeLaneKey("CartBadge")).not.toBe(typeLaneKey("ListItem"));
  });

  it("nests an instance key under its type key", () => {
    const key = instanceLaneKey("ListItem", id(12));
    expect(parentLaneKey(key)).toBe(typeLaneKey("ListItem"));
    expect(laneChain(key)).toEqual([typeLaneKey("ListItem"), key]);
  });

  it("has no parent above a type key", () => {
    expect(parentLaneKey(typeLaneKey("App"))).toBeNull();
    expect(laneChain(typeLaneKey("App"))).toEqual([typeLaneKey("App")]);
  });

  it("survives a component name containing the instance separator", () => {
    const key = instanceLaneKey("Odd#Name", id(3));
    expect(parentLaneKey(key)).toBe(typeLaneKey("Odd#Name"));
  });
});

describe("visibility", () => {
  const badge = typeLaneKey("CartBadge");
  const list = typeLaneKey("ListItem");
  const item12 = instanceLaneKey("ListItem", id(12));

  it("shows everything when nothing is soloed or muted", () => {
    expect(isLaneVisible(EMPTY_LANE_FILTER, badge)).toBe(true);
    expect(isLaneVisible(EMPTY_LANE_FILTER, item12)).toBe(true);
  });

  it("hides a muted lane and its instances", () => {
    const f = toggleMute(EMPTY_LANE_FILTER, list);
    expect(isLaneVisible(f, list)).toBe(false);
    expect(isLaneVisible(f, item12)).toBe(false);
    expect(isLaneVisible(f, badge)).toBe(true);
  });

  it("hides only the muted instance, not its siblings or its type", () => {
    const f = toggleMute(EMPTY_LANE_FILTER, item12);
    expect(isLaneVisible(f, item12)).toBe(false);
    expect(isLaneVisible(f, instanceLaneKey("ListItem", id(13)))).toBe(true);
    expect(isLaneVisible(f, list)).toBe(true);
  });

  it("hides every lane except the soloed one", () => {
    const f = toggleSolo(EMPTY_LANE_FILTER, badge);
    expect(isLaneVisible(f, badge)).toBe(true);
    expect(isLaneVisible(f, list)).toBe(false);
    expect(isLaneVisible(f, item12)).toBe(false);
  });

  it("keeps a soloed instance visible along with its type lane", () => {
    const f = toggleSolo(EMPTY_LANE_FILTER, item12);
    expect(isLaneVisible(f, item12)).toBe(true);
    expect(isLaneVisible(f, list)).toBe(true);
    expect(isLaneVisible(f, instanceLaneKey("ListItem", id(13)))).toBe(false);
    expect(isLaneVisible(f, badge)).toBe(false);
  });

  it("lets mute win over solo on the same lane", () => {
    const f = toggleMute(toggleSolo(EMPTY_LANE_FILTER, badge), badge);
    expect(isLaneVisible(f, badge)).toBe(false);
  });

  it("reports why a lane is hidden so the UI can label it", () => {
    const soloed = toggleSolo(EMPTY_LANE_FILTER, badge);
    expect(laneVisibility(soloed, badge)).toBe("visible");
    expect(laneVisibility(soloed, list)).toBe("unsoloed");
    expect(laneVisibility(toggleMute(EMPTY_LANE_FILTER, list), list)).toBe("muted");
  });
});

describe("replay mute", () => {
  it("mutes every instance when the component type is muted", () => {
    const filter = toggleMute(EMPTY_LANE_FILTER, typeLaneKey("Analytics"));
    expect(isComponentReplayMuted(filter, "Analytics", id(1))).toBe(true);
    expect(isComponentReplayMuted(filter, "Analytics", id(2))).toBe(true);
    expect(isComponentReplayMuted(filter, "Cart", id(3))).toBe(false);
  });

  it("can mute one instance without muting its siblings", () => {
    const filter = toggleMute(EMPTY_LANE_FILTER, instanceLaneKey("Player", id(7)));
    expect(isComponentReplayMuted(filter, "Player", id(7))).toBe(true);
    expect(isComponentReplayMuted(filter, "Player", id(8))).toBe(false);
  });

  it("does not turn solo into replay exclusion", () => {
    const filter = toggleSolo(EMPTY_LANE_FILTER, typeLaneKey("Cart"));
    expect(isComponentReplayMuted(filter, "Analytics", id(1))).toBe(false);
  });
});

describe("reversibility", () => {
  it("restores the original filter when a toggle is undone", () => {
    const once = toggleMute(EMPTY_LANE_FILTER, typeLaneKey("Tooltip"));
    const twice = toggleMute(once, typeLaneKey("Tooltip"));
    expect(isLaneVisible(twice, typeLaneKey("Tooltip"))).toBe(true);
    expect(serializeLaneFilter(twice)).toEqual(serializeLaneFilter(EMPTY_LANE_FILTER));
  });

  it("never mutates the filter it is given", () => {
    const before = serializeLaneFilter(EMPTY_LANE_FILTER);
    toggleSolo(EMPTY_LANE_FILTER, typeLaneKey("Header"));
    expect(serializeLaneFilter(EMPTY_LANE_FILTER)).toEqual(before);
  });

  it("clears every lane back to visible", () => {
    const f = toggleSolo(toggleMute(EMPTY_LANE_FILTER, typeLaneKey("A")), typeLaneKey("B"));
    const cleared = clearLaneFilter(f);
    expect(isLaneVisible(cleared, typeLaneKey("A"))).toBe(true);
    expect(isLaneVisible(cleared, typeLaneKey("C"))).toBe(true);
  });
});

describe("serialization", () => {
  it("round-trips through JSON", () => {
    const f = toggleSolo(
      toggleMute(EMPTY_LANE_FILTER, typeLaneKey("Tooltip")),
      typeLaneKey("Cart"),
    );
    const back = deserializeLaneFilter(JSON.parse(JSON.stringify(serializeLaneFilter(f))));
    expect(isLaneVisible(back, typeLaneKey("Tooltip"))).toBe(false);
    expect(isLaneVisible(back, typeLaneKey("Cart"))).toBe(true);
    expect(isLaneVisible(back, typeLaneKey("Other"))).toBe(false);
  });

  it("emits keys in a stable order so persisted state does not churn", () => {
    const a = toggleMute(toggleMute(EMPTY_LANE_FILTER, typeLaneKey("B")), typeLaneKey("A"));
    const b = toggleMute(toggleMute(EMPTY_LANE_FILTER, typeLaneKey("A")), typeLaneKey("B"));
    expect(serializeLaneFilter(a)).toEqual(serializeLaneFilter(b));
  });

  it("falls back to an empty filter on malformed input", () => {
    expect(serializeLaneFilter(deserializeLaneFilter(null))).toEqual(
      serializeLaneFilter(EMPTY_LANE_FILTER),
    );
    expect(serializeLaneFilter(deserializeLaneFilter({ solo: "nope" }))).toEqual(
      serializeLaneFilter(EMPTY_LANE_FILTER),
    );
    expect(serializeLaneFilter(deserializeLaneFilter({ v: 1, muted: [1, "t:Ok"] }))).toEqual({
      v: 1,
      solo: [],
      muted: ["t:Ok"],
    });
  });
});
