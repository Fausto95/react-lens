import { describe, it, expect } from "vite-plus/test";
import {
  commandsOnPanelConnect,
  commandsOnPanelDisconnect,
  commandsOnPageConnect,
} from "./pairing.js";

describe("panel pairing commands", () => {
  it("re-asserts recording when a panel connects", () => {
    expect(commandsOnPanelConnect()).toEqual([{ kind: "record", recording: true }]);
  });

  it("leaves the replay request to the panel, which owns the cursor", () => {
    // The background is stateless and cannot know how much the panel already
    // ingested; synthesizing `panel-ready` here re-sent the whole buffer on
    // every service-worker restart, duplicating events and reordering the log.
    expect(commandsOnPanelConnect().some((c) => c.kind === "panel-ready")).toBe(false);
  });

  it("does not stop page capture when the panel disconnects", () => {
    // Stopping here was the reliability bug: disconnect sent `record: false`,
    // the page stopped instrumentation, and reconnect only sent `panel-ready` —
    // so live commits after a DevTools/tab churn never became frames again.
    expect(commandsOnPanelDisconnect()).toEqual([]);
    expect(commandsOnPanelDisconnect().some((c) => c.kind === "record")).toBe(false);
  });

  it("never emits record:false — capture stays on", () => {
    const cmds = [...commandsOnPanelConnect(), ...commandsOnPanelDisconnect()];
    expect(cmds.some((c) => c.kind === "record" && c.recording === false)).toBe(false);
  });

  it("tells the panel to resync when a page port (re)connects", () => {
    // A reloaded page or a restarted worker brings a new page port; only the
    // panel knows which messages it is still missing.
    expect(commandsOnPageConnect()).toEqual([{ kind: "page-connected" }]);
  });
});
