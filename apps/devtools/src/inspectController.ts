import type { ComponentId } from "@react-lens/protocol";
import type { ComponentInstance } from "@react-lens/protocol";
import type { LensRuntime } from "./runtime.js";
import type { Highlighter } from "./highlighter.js";
import { openInEditor } from "./openInEditor.js";

export interface InspectPick {
  componentId: ComponentId;
  name: string;
  sourceFile?: string;
  sourceLine?: number;
}

export interface InspectController {
  start(): void;
  stop(): void;
  isActive(): boolean;
  dispose(): void;
}

/** How many DOM ancestors to scan when building the hover component chain. */
const CHAIN_MAX = 12;

/** Embedded-page inspect mode (same UX as the extension MAIN-world controller). */
export function createInspectController(opts: {
  runtime: LensRuntime;
  highlighter: Highlighter;
  onPick: (pick: InspectPick) => void;
  /** Single source of truth for the host's button state — fires on every start/stop. */
  onStateChange?: (active: boolean) => void;
  ignoreRoot?: () => Node | null;
}): InspectController {
  const { runtime, highlighter, onPick, onStateChange, ignoreRoot } = opts;
  let active = false;
  let tooltip: HTMLDivElement | null = null;
  let backdrop: HTMLDivElement | null = null;
  let tipSource: { file: string; line: number } | null = null;
  let editing: HTMLElement | null = null;
  let editingId: ComponentId | null = null;
  /** Text before a double-click edit began — Escape restores it. */
  let editingOriginal: string | null = null;
  let ephemeralBadge: HTMLDivElement | null = null;
  // Hover state: the component chain under the pointer (deepest → outermost)
  // and the index the user has walked to with Alt+wheel. Click picks the
  // walked component, not the deepest.
  let chain: ComponentInstance[] = [];
  let chainIndex = 0;
  let pointer = { x: 0, y: 0 };

  function ignored(target: EventTarget | null): boolean {
    if (target instanceof Element && target.closest("#react-lens-inspect-tip")) return true;
    const root = ignoreRoot?.();
    if (!root || !(target instanceof Node)) return false;
    return root === target || root.contains(target);
  }

  function ensureTooltip(): HTMLDivElement {
    if (tooltip) return tooltip;
    const el = document.createElement("div");
    el.id = "react-lens-inspect-tip";
    Object.assign(el.style, {
      position: "fixed",
      zIndex: "2147483646",
      pointerEvents: "auto",
      padding: "4px 8px",
      borderRadius: "6px",
      background: "var(--rl-inspect-tip-bg, rgba(18,21,26,0.94))",
      color: "var(--rl-inspect-tip-text, #e6e9ef)",
      font: "11px ui-sans-serif, system-ui, sans-serif",
      border: "1px solid var(--rl-inspect-tip-border, #2f3644)",
      maxWidth: "360px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      display: "none",
      cursor: "default",
    } satisfies Partial<CSSStyleDeclaration>);
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (tipSource) openInEditor(tipSource.file, tipSource.line);
    });
    document.documentElement.appendChild(el);
    tooltip = el;
    return el;
  }

  /** Page dim with a cut-out over the highlighted nodes (crosshair focus). */
  function ensureBackdrop(): HTMLDivElement {
    if (backdrop) return backdrop;
    const el = document.createElement("div");
    el.id = "react-lens-inspect-backdrop";
    Object.assign(el.style, {
      position: "fixed",
      zIndex: "2147483644",
      pointerEvents: "none",
      borderRadius: "4px",
      boxShadow: "0 0 0 100000px var(--rl-inspect-dim, rgba(8,10,14,0.28))",
      display: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    document.documentElement.appendChild(el);
    backdrop = el;
    return el;
  }

  function showBackdrop(nodes: Node[]): void {
    const el = ensureBackdrop();
    let rect: DOMRect | null = null;
    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      const r = node.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      rect = rect
        ? DOMRect.fromRect({
            x: Math.min(rect.x, r.x),
            y: Math.min(rect.y, r.y),
            width: Math.max(rect.right, r.right) - Math.min(rect.x, r.x),
            height: Math.max(rect.bottom, r.bottom) - Math.min(rect.y, r.y),
          })
        : r;
    }
    if (!rect) {
      el.style.display = "none";
      return;
    }
    el.style.display = "block";
    el.style.left = `${rect.left - 3}px`;
    el.style.top = `${rect.top - 3}px`;
    el.style.width = `${rect.width + 6}px`;
    el.style.height = `${rect.height + 6}px`;
  }

  function hideBackdrop(): void {
    if (backdrop) backdrop.style.display = "none";
  }

  function showTip(
    text: string,
    x: number,
    y: number,
    source: { file: string; line: number } | null,
  ): void {
    const el = ensureTooltip();
    tipSource = source;
    el.textContent = source ? `${text} · open ↗` : text;
    el.style.cursor = source ? "pointer" : "default";
    el.title = source ? "Open in editor" : "";
    el.style.display = "block";
    el.style.left = `${Math.min(x + 12, window.innerWidth - 200)}px`;
    el.style.top = `${Math.min(y + 16, window.innerHeight - 32)}px`;
  }

  function hideTip(): void {
    tipSource = null;
    if (tooltip) tooltip.style.display = "none";
  }

  /** Highlight + tooltip + backdrop for one instance (hover or walked-to). */
  function focusInstance(inst: ComponentInstance): void {
    const nodes = runtime.domNodesOf(inst.id);
    highlighter.show(nodes);
    showBackdrop(nodes);
    const src = inst.source;
    const loc = src ? `${src.file.split("/").pop()}:${src.line}` : null;
    const renders = runtime.store.renderCount(inst.id);
    const self = runtime.store.selfTimeTotal(inst.id);
    const stats = `${renders}× · ${Number(self.toFixed(1))}ms`;
    const depth = chain.length > 1 ? ` · ${chainIndex + 1}/${chain.length} ⌥scroll` : "";
    showTip(
      loc ? `${inst.name} · ${stats} · ${loc}${depth}` : `${inst.name} · ${stats}${depth}`,
      pointer.x,
      pointer.y,
      src ? { file: src.file, line: src.line } : null,
    );
  }

  /** Component chain under a DOM node: deepest → outermost, distinct ids. */
  function chainFor(node: Node): ComponentInstance[] {
    const out: ComponentInstance[] = [];
    const seen = new Set<ComponentId>();
    let cur: Node | null = node;
    let hops = 0;
    while (cur && out.length < CHAIN_MAX && hops < 200) {
      const inst = runtime.resolveComponent(cur);
      if (!inst) break;
      if (!seen.has(inst.id)) {
        seen.add(inst.id);
        out.push(inst);
      }
      // Continue above this component's outermost DOM node.
      const nodes = runtime.domNodesOf(inst.id);
      const top = nodes.find((n) => n instanceof Element) as Element | undefined;
      cur = (top ?? (cur as Element)).parentNode;
      hops++;
    }
    return out;
  }

  function onMove(e: MouseEvent): void {
    if (!active || ignored(e.target)) return;
    const node = e.target;
    if (!(node instanceof Node)) return;
    pointer = { x: e.clientX, y: e.clientY };
    const next = chainFor(node);
    if (next.length === 0) {
      chain = [];
      chainIndex = 0;
      highlighter.hide();
      hideBackdrop();
      hideTip();
      return;
    }
    // A new hover target resets the walk to the deepest component.
    if (next[0]!.id !== chain[0]?.id) {
      chain = next;
      chainIndex = 0;
    } else {
      chain = next;
      chainIndex = Math.min(chainIndex, chain.length - 1);
    }
    focusInstance(chain[chainIndex]!);
  }

  function onWheel(e: WheelEvent): void {
    if (!active || !e.altKey || chain.length === 0 || ignored(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.deltaY < 0 ? 1 : -1; // scroll up → outward
    chainIndex = Math.max(0, Math.min(chain.length - 1, chainIndex + dir));
    focusInstance(chain[chainIndex]!);
  }

  function onClick(e: MouseEvent): void {
    if (!active || ignored(e.target) || editing) return;
    e.preventDefault();
    e.stopPropagation();
    const node = e.target;
    if (!(node instanceof Node)) return;
    // Pick what the user SEES: the walked-to component when Alt+wheel was
    // used, else the deepest component under the pointer.
    const inst = chain[chainIndex] ?? runtime.resolveComponent(node);
    if (!inst) return;
    onPick({
      componentId: inst.id,
      name: inst.name,
      ...(inst.source
        ? { sourceFile: inst.source.file, sourceLine: inst.source.line }
        : {}),
    });
    highlighter.show(runtime.domNodesOf(inst.id));
  }

  function onKey(e: KeyboardEvent): void {
    if (!active) return;
    if (e.key === "Escape") {
      if (editing) {
        cancelEdit();
        e.preventDefault();
        return;
      }
      stop();
      e.preventDefault();
    }
  }

  function onWindowBlur(): void {
    // Leaving the window (app switch, devtools focus) disarms the picker so
    // it never fires on a stale return click.
    stop();
  }

  function onDblClick(e: MouseEvent): void {
    if (!active || ignored(e.target)) return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const textEl = findTextHost(target);
    if (!textEl) return;
    const inst = runtime.resolveComponent(textEl);
    if (!inst) return;
    e.preventDefault();
    e.stopPropagation();
    beginEdit(textEl, inst.id);
  }

  function findTextHost(el: HTMLElement): HTMLElement | null {
    let cur: HTMLElement | null = el;
    for (let i = 0; i < 4 && cur; i++) {
      const t = (cur.innerText || cur.textContent || "").trim();
      if (t.length > 0 && t.length < 500 && cur.children.length <= 3) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function beginEdit(el: HTMLElement, id: ComponentId): void {
    cancelEdit();
    editing = el;
    editingId = id;
    editingOriginal = el.textContent ?? "";
    el.contentEditable = "true";
    Object.assign(el.style, {
      outline: "2px solid var(--rl-inspect-edit, #60a5fa)",
      outlineOffset: "2px",
    });
    el.focus();
    const onKeyEdit = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        el.blur();
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        cancelEdit();
      }
    };
    el.addEventListener("blur", () => commitEdit(), { once: true });
    el.addEventListener("keydown", onKeyEdit);
    (el as HTMLElement & { _rlCleanup?: () => void })._rlCleanup = () => {
      el.removeEventListener("keydown", onKeyEdit);
    };
  }

  function commitEdit(): void {
    const el = editing;
    const id = editingId;
    if (!el || id == null) return;
    const text = (el.innerText ?? el.textContent ?? "").trimEnd();
    cleanupEditChrome(el);
    editing = null;
    editingId = null;
    editingOriginal = null;
    const ok =
      runtime.canEditValues() &&
      (runtime.setProp(id, ["children"], text) ||
        ["title", "label", "text", "value", "placeholder", "alt", "aria-label"].some((k) =>
          runtime.setProp(id, [k], text),
        ));
    if (!ok) showEphemeralBadge(el);
  }

  function cancelEdit(): void {
    const el = editing;
    if (!el) return;
    // Cancel means CANCEL: put the pre-edit text back.
    if (editingOriginal !== null) el.textContent = editingOriginal;
    cleanupEditChrome(el);
    editing = null;
    editingId = null;
    editingOriginal = null;
  }

  function cleanupEditChrome(el: HTMLElement): void {
    el.contentEditable = "false";
    el.style.outline = "";
    el.style.outlineOffset = "";
    (el as HTMLElement & { _rlCleanup?: () => void })._rlCleanup?.();
  }

  function showEphemeralBadge(anchor: HTMLElement): void {
    ephemeralBadge?.remove();
    const b = document.createElement("div");
    b.textContent = "DOM-only · resets on re-render";
    Object.assign(b.style, {
      position: "fixed",
      zIndex: "2147483647",
      padding: "3px 8px",
      borderRadius: "4px",
      background: "var(--rl-inspect-badge, rgba(251,146,60,0.95))",
      color: "var(--rl-inspect-badge-text, #0b0d10)",
      font: "10px ui-sans-serif, system-ui, sans-serif",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    const r = anchor.getBoundingClientRect();
    b.style.left = `${Math.max(8, r.left)}px`;
    b.style.top = `${Math.max(8, r.top - 22)}px`;
    document.documentElement.appendChild(b);
    ephemeralBadge = b;
    setTimeout(() => {
      b.remove();
      if (ephemeralBadge === b) ephemeralBadge = null;
    }, 2400);
  }

  function start(): void {
    if (active) return;
    active = true;
    document.documentElement.style.cursor = "crosshair";
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("dblclick", onDblClick, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("blur", onWindowBlur);
    onStateChange?.(true);
  }

  function stop(): void {
    if (!active) return;
    active = false;
    cancelEdit();
    chain = [];
    chainIndex = 0;
    document.documentElement.style.cursor = "";
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dblclick", onDblClick, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("wheel", onWheel, { capture: true });
    window.removeEventListener("blur", onWindowBlur);
    highlighter.hide();
    hideBackdrop();
    hideTip();
    onStateChange?.(false);
  }

  return {
    start,
    stop,
    isActive: () => active,
    dispose: () => {
      stop();
      tooltip?.remove();
      backdrop?.remove();
      ephemeralBadge?.remove();
    },
  };
}
