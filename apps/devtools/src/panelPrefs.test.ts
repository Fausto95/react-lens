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

  it("round-trips dock width and split percent", () => {
    savePanelPrefs({ dockWidth: 520, splitPct: 35 });
    expect(loadPanelPrefs().dockWidth).toBe(520);
    expect(loadPanelPrefs().splitPct).toBe(35);
  });

  it("clamps splitPct into the drag range", () => {
    savePanelPrefs({ splitPct: 5 });
    expect(loadPanelPrefs().splitPct).toBe(22);
    savePanelPrefs({ splitPct: 99 });
    expect(loadPanelPrefs().splitPct).toBe(78);
  });
});
