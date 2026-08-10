/**
 * Fast custom tooltips for the panel, replacing the native `title` tooltip
 * (which takes ~1s to appear and ignores the theme).
 *
 * One delegated layer on the panel root — no per-call-site component. Any
 * descendant with a `title` attribute gets the custom tooltip: on first
 * hover/focus the title is moved to `data-rl-tip` (suppressing the native
 * bubble before its show delay elapses) and a themed bubble is shown after a
 * short delay. Moving between tooltipped controls while the layer is "warm"
 * shows the next tip immediately, like native menus.
 *
 * Framework-free DOM controller so the behavior is unit-testable without
 * React; the Panel binds it in an effect.
 */

const SHOW_DELAY_MS = 120;
const WARM_WINDOW_MS = 350;
const GAP_PX = 6;
const EDGE_PX = 4;
export const TIP_ATTR = "data-rl-tip";

export interface TooltipLayer {
  dispose(): void;
}

export function createTooltipLayer(root: HTMLElement): TooltipLayer {
  const doc = root.ownerDocument;
  let bubble: HTMLDivElement | null = null;
  let anchor: Element | null = null;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let visible = false;
  let lastHideAt = -Infinity;

  const now = () => performance.now();

  /** Move `title` to `data-rl-tip` so the native tooltip never fires. React
   * re-sets `title` when its value changes, which refreshes the tip here. */
  const captureTitle = (el: Element): void => {
    const title = el.getAttribute("title");
    if (title === null) return;
    el.removeAttribute("title");
    if (!title) return;
    el.setAttribute(TIP_ATTR, title);
    // The title was the accessible name for icon-only elements without one.
    if (!el.hasAttribute("aria-label") && !(el.textContent ?? "").trim()) {
      el.setAttribute("aria-label", title);
    }
  };

  const cancelTimer = (): void => {
    if (showTimer !== null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
  };

  const hide = (): void => {
    cancelTimer();
    anchor = null;
    if (!visible) return;
    visible = false;
    lastHideAt = now();
    bubble?.classList.remove("visible");
  };

  const position = (tip: HTMLDivElement, target: Element): void => {
    const view = doc.defaultView;
    if (!view) return;
    const r = target.getBoundingClientRect();
    const b = tip.getBoundingClientRect();
    let top = r.bottom + GAP_PX;
    if (top + b.height > view.innerHeight - EDGE_PX) top = r.top - GAP_PX - b.height;
    const left = Math.max(
      EDGE_PX,
      Math.min(r.left + r.width / 2 - b.width / 2, view.innerWidth - b.width - EDGE_PX),
    );
    tip.style.top = `${Math.max(EDGE_PX, top)}px`;
    tip.style.left = `${left}px`;
  };

  const show = (): void => {
    showTimer = null;
    const target = anchor;
    const text = target?.getAttribute(TIP_ATTR);
    if (!target || !text) return;
    if (!bubble) {
      bubble = doc.createElement("div");
      bubble.className = "rl-tooltip";
      bubble.setAttribute("role", "tooltip");
      root.appendChild(bubble);
    }
    bubble.textContent = text;
    bubble.classList.add("visible");
    visible = true;
    position(bubble, target);
  };

  const adopt = (el: Element, immediate: boolean): void => {
    if (el === anchor) return;
    captureTitle(el);
    if (!el.getAttribute(TIP_ATTR)) {
      hide();
      return;
    }
    const warm = visible || now() - lastHideAt < WARM_WINDOW_MS;
    cancelTimer();
    anchor = el;
    if (immediate || warm) show();
    else showTimer = setTimeout(show, SHOW_DELAY_MS);
  };

  const resolve = (target: EventTarget | null): Element | null =>
    target instanceof Element ? target.closest(`[title], [${TIP_ATTR}]`) : null;

  const onOver = (e: Event): void => {
    const el = resolve(e.target);
    if (el && root.contains(el)) adopt(el, false);
    else if (anchor) hide();
  };

  const onOut = (e: Event): void => {
    if (!anchor) return;
    const related = (e as MouseEvent).relatedTarget;
    if (related instanceof Node && anchor.contains(related)) return;
    hide();
  };

  const onFocusIn = (e: Event): void => {
    const el = resolve(e.target);
    if (el && root.contains(el)) adopt(el, true);
  };

  const onFocusOut = (): void => hide();
  const onPointerDown = (): void => hide();
  const onScroll = (): void => hide();

  root.addEventListener("mouseover", onOver);
  root.addEventListener("mouseout", onOut);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("scroll", onScroll, true);

  return {
    dispose() {
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseout", onOut);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("scroll", onScroll, true);
      cancelTimer();
      bubble?.remove();
      bubble = null;
      anchor = null;
    },
  };
}
