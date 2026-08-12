import { describe, it, expect } from "vite-plus/test";
import { commandsOnPanelConnect, commandsOnPanelDisconnect } from "./pairing.js";

describe("panel pairing commands", () => {
  it("re-asserts recording and asks the content buffer to replay on connect", () => {
    expect(commandsOnPanelConnect()).toEqual([
      { kind: "record", recording: true },
      { kind: "panel-ready" },
    ]);
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
});
