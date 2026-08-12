import { describe, it, expect } from "vite-plus/test";
import { timelineKeyAction } from "./keymap.js";

type KeyEvent = Parameters<typeof timelineKeyAction>[0];

function ev(partial: Partial<KeyEvent>): KeyEvent {
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  };
}

describe("timelineKeyAction", () => {
  it("sets in/out from bracket keys (layout-independent)", () => {
    expect(timelineKeyAction(ev({ key: "^", code: "BracketLeft" }))).toEqual({
      kind: "set-in",
    });
    expect(timelineKeyAction(ev({ key: "$", code: "BracketRight" }))).toEqual({
      kind: "set-out",
    });
  });

  it("allows Alt when typing [ ] on AZERTY", () => {
    expect(timelineKeyAction(ev({ key: "[", code: "Digit5", altKey: true }))).toEqual({
      kind: "set-in",
    });
  });

  it("never fires with meta or ctrl held", () => {
    expect(timelineKeyAction(ev({ key: "[", code: "BracketLeft", metaKey: true }))).toBeNull();
    expect(timelineKeyAction(ev({ key: "l", code: "KeyL", ctrlKey: true }))).toBeNull();
  });

  it("binds transport and view keys", () => {
    expect(timelineKeyAction(ev({ key: " ", code: "Space" }))).toEqual({ kind: "toggle-play" });
    expect(timelineKeyAction(ev({ key: "j", code: "KeyJ" }))).toEqual({ kind: "play-reverse" });
    expect(timelineKeyAction(ev({ key: "k", code: "KeyK" }))).toEqual({ kind: "stop" });
    expect(timelineKeyAction(ev({ key: "l", code: "KeyL" }))).toEqual({ kind: "play-forward" });
    expect(timelineKeyAction(ev({ key: "0", code: "Digit0" }))).toEqual({ kind: "fit" });
    expect(timelineKeyAction(ev({ key: "f", code: "KeyF" }))).toEqual({ kind: "fit-selection" });
    expect(timelineKeyAction(ev({ key: "?", code: "Slash" }))).toEqual({ kind: "toggle-help" });
    expect(timelineKeyAction(ev({ key: "Escape", code: "Escape" }))).toEqual({
      kind: "escape-band",
    });
  });

  it("zooms from typed + / -", () => {
    expect(timelineKeyAction(ev({ key: "+", code: "Equal" }))).toEqual({
      kind: "zoom",
      factor: 0.72,
    });
    expect(timelineKeyAction(ev({ key: "-", code: "Digit6" }))).toEqual({
      kind: "zoom",
      factor: 1.4,
    });
  });

  it("nudges the playhead with arrows", () => {
    expect(timelineKeyAction(ev({ key: "ArrowLeft", code: "ArrowLeft" }))).toEqual({
      kind: "nudge-playhead",
      dir: -1,
    });
  });

  it("steps commits with shift+arrows", () => {
    expect(timelineKeyAction(ev({ key: "ArrowLeft", code: "ArrowLeft", shiftKey: true }))).toEqual({
      kind: "step-commit",
      dir: -1,
    });
    expect(
      timelineKeyAction(ev({ key: "ArrowRight", code: "ArrowRight", shiftKey: true })),
    ).toEqual({ kind: "step-commit", dir: 1 });
  });

  it("returns to live with End or period", () => {
    expect(timelineKeyAction(ev({ key: "End", code: "End" }))).toEqual({ kind: "go-live" });
    expect(timelineKeyAction(ev({ key: ".", code: "Period" }))).toEqual({ kind: "go-live" });
  });
});
