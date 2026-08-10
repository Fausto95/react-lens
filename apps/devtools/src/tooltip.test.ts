import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTooltipLayer, TIP_ATTR, type TooltipLayer } from "./tooltip.js";

const SHOW_DELAY_MS = 120;
const WARM_WINDOW_MS = 350;

function hover(el: Element, relatedTarget: Element | null = null): void {
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  void relatedTarget;
}

function unhover(el: Element, relatedTarget: Element | null = null): void {
  el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget }));
}

function bubbleOf(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".rl-tooltip");
}

function visibleBubble(root: HTMLElement): HTMLElement | null {
  const b = bubbleOf(root);
  return b?.classList.contains("visible") ? b : null;
}

describe("createTooltipLayer", () => {
  let root: HTMLElement;
  let layer: TooltipLayer;
  let a: HTMLButtonElement;
  let b: HTMLButtonElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    root = document.createElement("div");
    a = document.createElement("button");
    a.setAttribute("title", "Export session");
    b = document.createElement("button");
    b.setAttribute("title", "Import session");
    root.append(a, b);
    document.body.appendChild(root);
    layer = createTooltipLayer(root);
  });

  afterEach(() => {
    layer.dispose();
    root.remove();
    vi.useRealTimers();
  });

  it("strips title on hover so the native tooltip never shows", () => {
    hover(a);
    expect(a.hasAttribute("title")).toBe(false);
    expect(a.getAttribute(TIP_ATTR)).toBe("Export session");
  });

  it("promotes the title to aria-label for icon-only elements", () => {
    hover(a);
    expect(a.getAttribute("aria-label")).toBe("Export session");
  });

  it("keeps an existing aria-label", () => {
    a.setAttribute("aria-label", "Custom label");
    hover(a);
    expect(a.getAttribute("aria-label")).toBe("Custom label");
  });

  it("shows the tooltip after a short delay, not immediately", () => {
    hover(a);
    expect(visibleBubble(root)).toBeNull();
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(visibleBubble(root)?.textContent).toBe("Export session");
  });

  it("moving to another tooltipped control shows its tip immediately (warm)", () => {
    hover(a);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    unhover(a, b);
    hover(b);
    expect(visibleBubble(root)?.textContent).toBe("Import session");
  });

  it("hides on mouseout and goes cold after the warm window", () => {
    hover(a);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    unhover(a);
    expect(visibleBubble(root)).toBeNull();
    vi.advanceTimersByTime(WARM_WINDOW_MS + 1);
    hover(b);
    expect(visibleBubble(root)).toBeNull();
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(visibleBubble(root)?.textContent).toBe("Import session");
  });

  it("does not show if the pointer leaves before the delay elapses", () => {
    hover(a);
    unhover(a);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(visibleBubble(root)).toBeNull();
  });

  it("shows immediately on keyboard focus", () => {
    a.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(visibleBubble(root)?.textContent).toBe("Export session");
    a.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(visibleBubble(root)).toBeNull();
  });

  it("picks up a refreshed title after React re-sets it", () => {
    hover(a);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    unhover(a);
    a.setAttribute("title", "Pause recording (R)");
    hover(a);
    expect(visibleBubble(root)?.textContent).toBe("Pause recording (R)");
    expect(a.hasAttribute("title")).toBe(false);
  });

  it("resolves the innermost tooltipped element for nested titles", () => {
    const pip = document.createElement("span");
    pip.setAttribute("title", "2 suspicious");
    a.appendChild(pip);
    hover(pip);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(visibleBubble(root)?.textContent).toBe("2 suspicious");
  });

  it("hides on pointerdown (click)", () => {
    hover(a);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    a.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(visibleBubble(root)).toBeNull();
  });

  it("dispose removes the bubble and stops reacting", () => {
    hover(a);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    layer.dispose();
    expect(bubbleOf(root)).toBeNull();
    hover(b);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(bubbleOf(root)).toBeNull();
  });
});
