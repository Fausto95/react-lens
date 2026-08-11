import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { REVEAL_MARGIN, needsReveal, pickRevealTarget, revealBehavior } from "./revealGeometry.js";

const VIEWPORT = { width: 1000, height: 800 };

function rect(top: number, height: number, left = 0, width = 100): DOMRect {
  return DOMRect.fromRect({ x: left, y: top, width, height });
}

describe("needsReveal", () => {
  it("leaves a comfortably visible element alone", () => {
    expect(needsReveal(rect(200, 100), VIEWPORT)).toBe(false);
  });

  it("reveals an element below the fold", () => {
    expect(needsReveal(rect(900, 100), VIEWPORT)).toBe(true);
  });

  it("reveals an element scrolled off the top", () => {
    expect(needsReveal(rect(-120, 100), VIEWPORT)).toBe(true);
  });

  it("treats the margin band as needing a reveal", () => {
    // Just inside the margin: still comfortable.
    expect(needsReveal(rect(REVEAL_MARGIN, 100), VIEWPORT)).toBe(false);
    // One pixel into the band at the top edge: nudge it.
    expect(needsReveal(rect(REVEAL_MARGIN - 1, 100), VIEWPORT)).toBe(true);
    // Same at the bottom edge.
    const bottomOk = VIEWPORT.height - REVEAL_MARGIN - 100;
    expect(needsReveal(rect(bottomOk, 100), VIEWPORT)).toBe(false);
    expect(needsReveal(rect(bottomOk + 1, 100), VIEWPORT)).toBe(true);
  });

  it("keeps an element taller than the viewport put once its top is in view", () => {
    // A full-page section can never fit inside the margins — scrolling to it
    // every time would fight the user.
    expect(needsReveal(rect(40, 2000), VIEWPORT)).toBe(false);
    expect(needsReveal(rect(-600, 2000), VIEWPORT)).toBe(true);
  });

  it("ignores the horizontal axis", () => {
    expect(needsReveal(rect(200, 100, 4000, 100), VIEWPORT)).toBe(false);
  });
});

describe("pickRevealTarget", () => {
  function withRect(el: Element, r: DOMRect): Element {
    el.getBoundingClientRect = () => r;
    return el;
  }

  it("returns the first element with a painted box", () => {
    const text = document.createTextNode("hi");
    const collapsed = withRect(document.createElement("span"), rect(0, 0, 0, 0));
    const real = withRect(document.createElement("div"), rect(10, 20));
    expect(pickRevealTarget([text, collapsed, real])).toBe(real);
  });

  it("returns null when nothing is painted", () => {
    const collapsed = withRect(document.createElement("span"), rect(0, 0, 0, 0));
    expect(pickRevealTarget([document.createTextNode("x"), collapsed])).toBe(null);
    expect(pickRevealTarget([])).toBe(null);
  });
});

describe("revealBehavior", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  function mockReducedMotion(matches: boolean): void {
    window.matchMedia = vi.fn(
      (query: string) => ({ matches, media: query }) as MediaQueryList,
    ) as unknown as typeof window.matchMedia;
  }

  it("animates by default", () => {
    mockReducedMotion(false);
    expect(revealBehavior()).toBe("smooth");
  });

  it("jumps when the user asked for reduced motion", () => {
    mockReducedMotion(true);
    expect(revealBehavior()).toBe("auto");
  });

  it("animates when matchMedia is unavailable", () => {
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    expect(revealBehavior()).toBe("smooth");
  });
});
