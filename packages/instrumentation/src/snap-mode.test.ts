import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createSnapMode, SNAP_MODE_STYLE_ID } from "./snap-mode.js";

beforeEach(() => {
  document.head.innerHTML = "";
});

const tag = () => document.getElementById(SNAP_MODE_STYLE_ID);

describe("snap mode", () => {
  it("installs a stylesheet that kills transitions", () => {
    const snap = createSnapMode(document);
    snap.on();
    const el = tag();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("transition");
    expect(el!.textContent).toContain("!important");
  });

  it("is idempotent — every scrub frame calls on()", () => {
    const snap = createSnapMode(document);
    snap.on();
    snap.on();
    snap.on();
    expect(document.head.querySelectorAll(`#${SNAP_MODE_STYLE_ID}`)).toHaveLength(1);
  });

  it("off() removes it, so the page animates again once live", () => {
    const snap = createSnapMode(document);
    snap.on();
    snap.off();
    expect(tag()).toBeNull();
    expect(snap.isOn()).toBe(false);
  });

  it("off() without on() is harmless", () => {
    const snap = createSnapMode(document);
    expect(() => snap.off()).not.toThrow();
  });

  it("adopts a tag left behind by a previous session instead of duplicating it", () => {
    // A reload with the panel open, or a second runtime in the same document.
    const stale = document.createElement("style");
    stale.id = SNAP_MODE_STYLE_ID;
    document.head.appendChild(stale);
    const snap = createSnapMode(document);
    snap.on();
    expect(document.head.querySelectorAll(`#${SNAP_MODE_STYLE_ID}`)).toHaveLength(1);
    snap.off();
    expect(tag()).toBeNull();
  });

  it("is inert with no document (SSR, worker)", () => {
    const snap = createSnapMode(undefined);
    expect(() => {
      snap.on();
      snap.off();
    }).not.toThrow();
    expect(snap.isOn()).toBe(false);
  });
});
