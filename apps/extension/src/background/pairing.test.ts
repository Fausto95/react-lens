import { describe, it, expect } from "vite-plus/test";
import { commandsOnPanelConnect, commandsOnPanelDisconnect } from "./pairing.js";

describe("panel pairing commands", () => {
  it("asks the content buffer to replay when a panel connects", () => {
    expect(commandsOnPanelConnect()).toEqual([{ kind: "panel-ready" }]);
  });

  it("does not stop page capture when the panel disconnects", () => {
    // Stopping here was the reliability bug: disconnect sent `record: false`,
    // the page stopped instrumentation, and reconnect only sent `panel-ready` —
    // so live commits after a DevTools/tab churn never became frames again.
    expect(commandsOnPanelDisconnect()).toEqual([]);
    expect(commandsOnPanelDisconnect().some((c) => c.kind === "record")).toBe(false);
  });
});
