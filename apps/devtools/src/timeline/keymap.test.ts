import { describe, it, expect } from "vite-plus/test";
import { timelineKeyAction } from "./keymap.js";

type KeyEvent = Parameters<typeof timelineKeyAction>[0];

function ev(partial: Partial<KeyEvent>): KeyEvent {
  return { key: "", code: "", metaKey: false, ctrlKey: false, altKey: false, ...partial };
}

describe("timelineKeyAction — layout-independent bindings", () => {
  it("steps interactions from the PHYSICAL bracket keys on any layout", () => {
    // AZERTY: the keys at the US [ ] positions type ^ and $ — the binding
    // must match on code, not on the typed character.
    expect(timelineKeyAction(ev({ key: "^", code: "BracketLeft" }))).toEqual({
      kind: "step-interaction",
      dir: -1,
    });
    expect(timelineKeyAction(ev({ key: "$", code: "BracketRight" }))).toEqual({
      kind: "step-interaction",
      dir: 1,
    });
  });

  it("steps interactions when [ ] are typed with Alt (AZERTY: Option+5 / Option+))", () => {
    expect(timelineKeyAction(ev({ key: "[", code: "Digit5", altKey: true }))).toEqual({
      kind: "step-interaction",
      dir: -1,
    });
    expect(timelineKeyAction(ev({ key: "]", code: "Minus", altKey: true }))).toEqual({
      kind: "step-interaction",
      dir: 1,
    });
  });

  it("still blocks Alt for character bindings (Alt+T types † — not a toggle)", () => {
    expect(timelineKeyAction(ev({ key: "†", code: "KeyT", altKey: true }))).toBeNull();
  });

  it("never fires with meta or ctrl held", () => {
    expect(timelineKeyAction(ev({ key: "[", code: "BracketLeft", metaKey: true }))).toBeNull();
    expect(timelineKeyAction(ev({ key: "l", code: "KeyL", ctrlKey: true }))).toBeNull();
  });

  it("keeps the character-based bindings", () => {
    expect(timelineKeyAction(ev({ key: "t", code: "KeyT" }))).toEqual({ kind: "toggle-collapse" });
    expect(timelineKeyAction(ev({ key: "L", code: "KeyL" }))).toEqual({ kind: "go-live" });
    expect(timelineKeyAction(ev({ key: "f", code: "KeyF" }))).toEqual({ kind: "fit" });
    expect(timelineKeyAction(ev({ key: "Escape", code: "Escape" }))).toEqual({
      kind: "escape-band",
    });
    expect(timelineKeyAction(ev({ key: " ", code: "Space" }))).toEqual({ kind: "toggle-play" });
    expect(timelineKeyAction(ev({ key: "ArrowLeft", code: "ArrowLeft" }))).toEqual({
      kind: "step-commit",
      dir: -1,
    });
    expect(timelineKeyAction(ev({ key: "ArrowRight", code: "ArrowRight" }))).toEqual({
      kind: "step-commit",
      dir: 1,
    });
  });

  it("zooms from the typed character so AZERTY's + - keep working", () => {
    // French layouts type + and - from different physical keys than US; the
    // characters are what the user reads on the keycap.
    expect(timelineKeyAction(ev({ key: "+", code: "Equal" }))).toEqual({
      kind: "zoom",
      factor: 1.25,
    });
    expect(timelineKeyAction(ev({ key: "=", code: "Equal" }))).toEqual({
      kind: "zoom",
      factor: 1.25,
    });
    expect(timelineKeyAction(ev({ key: "-", code: "Digit6" }))).toEqual({
      kind: "zoom",
      factor: 0.8,
    });
    expect(timelineKeyAction(ev({ key: "_", code: "Digit8" }))).toEqual({
      kind: "zoom",
      factor: 0.8,
    });
  });

  it("returns null for unbound keys", () => {
    expect(timelineKeyAction(ev({ key: "x", code: "KeyX" }))).toBeNull();
    expect(timelineKeyAction(ev({ key: "/", code: "Slash" }))).toBeNull();
  });
});
