import { describe, it, expect, beforeEach } from "vite-plus/test";
import { loadPanelPrefs, savePanelPrefs } from "./panelPrefs.js";

beforeEach(() => {
  localStorage.clear();
});

describe("panel prefs", () => {
  it("defaults travelOn to true", () => {
    expect(loadPanelPrefs().travelOn).toBe(true);
  });

  it("round-trips travelOn", () => {
    savePanelPrefs({ travelOn: false });
    expect(loadPanelPrefs().travelOn).toBe(false);
    savePanelPrefs({ travelOn: true });
    expect(loadPanelPrefs().travelOn).toBe(true);
  });

  it("merges patches without dropping other keys", () => {
    savePanelPrefs({ travelOn: false });
    savePanelPrefs({});
    expect(loadPanelPrefs().travelOn).toBe(false);
  });

  it("falls back to defaults on corrupt storage", () => {
    localStorage.setItem("react-lens/panel-prefs", "{not json");
    expect(loadPanelPrefs().travelOn).toBe(true);
  });

  it("round-trips dock and column widths", () => {
    savePanelPrefs({ dockWidth: 520, treeWidth: 300, inspectorWidth: 360 });
    expect(loadPanelPrefs().dockWidth).toBe(520);
    expect(loadPanelPrefs().treeWidth).toBe(300);
    expect(loadPanelPrefs().inspectorWidth).toBe(360);
  });

  it("clamps column widths into their drag ranges", () => {
    savePanelPrefs({ treeWidth: 10, inspectorWidth: 9999 });
    expect(loadPanelPrefs().treeWidth).toBe(180);
    expect(loadPanelPrefs().inspectorWidth).toBe(560);
  });

  it("round-trips the solo/mute filter", () => {
    savePanelPrefs({ laneFilter: { v: 1, solo: ["t:Cart"], muted: ["t:Tooltip"] } });
    expect(loadPanelPrefs().laneFilter).toEqual({
      v: 1,
      solo: ["t:Cart"],
      muted: ["t:Tooltip"],
    });
  });

  it("drops a corrupt lane filter rather than hiding lanes forever", () => {
    savePanelPrefs({ laneFilter: { v: 1, solo: "nope", muted: [7] } as never });
    expect(loadPanelPrefs().laneFilter).toEqual({ v: 1, solo: [], muted: [] });
  });

  it("defaults retention to the store's own caps", () => {
    const prefs = loadPanelPrefs();
    expect(prefs.maxEvents).toBe(10_000);
    // No time window until the user asks for one.
    expect(prefs.maxAgeMs).toBeNull();
  });

  it("round-trips retention settings", () => {
    savePanelPrefs({ maxEvents: 50_000, maxAgeMs: 120_000 });
    expect(loadPanelPrefs().maxEvents).toBe(50_000);
    expect(loadPanelPrefs().maxAgeMs).toBe(120_000);
  });

  it("clamps the event cap to a usable range", () => {
    // A zero cap would throw in the ring buffer; an unbounded one would OOM.
    savePanelPrefs({ maxEvents: 0 });
    expect(loadPanelPrefs().maxEvents).toBe(1_000);
    savePanelPrefs({ maxEvents: 10_000_000 });
    expect(loadPanelPrefs().maxEvents).toBe(500_000);
  });

  it("treats a non-positive window as no window", () => {
    savePanelPrefs({ maxAgeMs: 0 });
    expect(loadPanelPrefs().maxAgeMs).toBeNull();
  });
});
