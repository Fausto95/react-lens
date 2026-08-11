import { describe, it, expect, beforeEach } from "vitest";
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
});
