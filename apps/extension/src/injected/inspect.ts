import type { ComponentId } from "@reactlens/protocol";
import type { FiberBridge } from "@reactlens/fiber";
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

/**
 * Page-side inspect mode: crosshair cursor, hover highlight, click → pick.
 * Tooltip shows component name + optional source. Double-click text starts
 * contentEditable; commit tries React override then ephemeral DOM.
 */
export function createInspectController(opts: {
  fiber: FiberBridge;
  highlighter: Highlighter;
  onPick: (pick: InspectPick) => void;
  onTextEdit?: (result: { componentId: ComponentId; text: string; mode: "react" | "dom" }) => void;
  /** Ignore events inside these nodes (panel host, etc.). */
  ignoreRoot?: () => Node | null;
}): InspectController {
  const { fiber, highlighter, onPick, onTextEdit, ignoreRoot } = opts;
  let active = false;
  let tooltip: HTMLDivElement | null = null;
  let tipSource: { file: string; line: number } | null = null;
  let editing: HTMLElement | null = null;
  let editingId: ComponentId | null = null;
  let ephemeralBadge: HTMLDivElement | null = null;

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
      background: "rgba(18,21,26,0.94)",
      color: "#e6e9ef",
      font: "11px ui-sans-serif, system-ui, sans-serif",
      border: "1px solid #2f3644",
      maxWidth: "320px",
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
    const left = Math.min(x + 12, window.innerWidth - 200);
    const top = Math.min(y + 16, window.innerHeight - 32);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function hideTip(): void {
    tipSource = null;
    if (tooltip) tooltip.style.display = "none";
  }

  function onMove(e: MouseEvent): void {
    if (!active || ignored(e.target)) return;
    const node = e.target;
    if (!(node instanceof Node)) return;
    const inst = fiber.resolveComponent(node);
    if (!inst) {
      highlighter.hide();
      hideTip();
      return;
    }
    highlighter.show(fiber.domNodesOf(inst.id));
    const src = inst.source;
    const loc = src ? `${src.file.split("/").pop()}:${src.line}` : null;
    showTip(
      loc ? `${inst.name} · ${loc}` : inst.name,
      e.clientX,
      e.clientY,
      src ? { file: src.file, line: src.line } : null,
    );
  }

  function onClick(e: MouseEvent): void {
    if (!active || ignored(e.target)) return;
    if (editing) return;
    e.preventDefault();
    e.stopPropagation();
    const node = e.target;
    if (!(node instanceof Node)) return;
    const inst = fiber.resolveComponent(node);
    if (!inst) return;
    const pick: InspectPick = {
      componentId: inst.id,
      name: inst.name,
      ...(inst.source ? { sourceFile: inst.source.file, sourceLine: inst.source.line } : {}),
    };
    onPick(pick);
    highlighter.show(fiber.domNodesOf(inst.id));
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

  function onDblClick(e: MouseEvent): void {
    if (!active || ignored(e.target)) return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    // Prefer a text-bearing element (not the whole page).
    const textEl = findTextHost(target);
    if (!textEl) return;
    const inst = fiber.resolveComponent(textEl);
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
    el.contentEditable = "true";
    el.dataset.rlEditing = "1";
    Object.assign(el.style, {
      outline: "2px solid #60a5fa",
      outlineOffset: "2px",
    });
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const onBlur = () => commitEdit();
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
    el.addEventListener("blur", onBlur, { once: true });
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

    const mode = tryReactTextOverride(fiber, id, text) ? "react" : "dom";
    if (mode === "dom") {
      // Ephemeral: already applied via contentEditable; show badge.
      showEphemeralBadge(el);
    }
    onTextEdit?.({ componentId: id, text, mode });
  }

  function cancelEdit(): void {
    const el = editing;
    if (!el) return;
    el.blur();
    cleanupEditChrome(el);
    editing = null;
    editingId = null;
  }

  function cleanupEditChrome(el: HTMLElement): void {
    el.contentEditable = "false";
    delete el.dataset.rlEditing;
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
      background: "rgba(251,146,60,0.95)",
      color: "#0b0d10",
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
  }

  function stop(): void {
    if (!active) return;
    active = false;
    cancelEdit();
    document.documentElement.style.cursor = "";
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dblclick", onDblClick, true);
    document.removeEventListener("keydown", onKey, true);
    highlighter.hide();
    hideTip();
  }

  return {
    start,
    stop,
    isActive: () => active,
    dispose: () => {
      stop();
      tooltip?.remove();
      tooltip = null;
      ephemeralBadge?.remove();
      ephemeralBadge = null;
    },
  };
}

/** Try overrideProps for children / common string props matching prior text. */
export function tryReactTextOverride(fiber: FiberBridge, id: ComponentId, text: string): boolean {
  if (!fiber.canEditValues()) return false;
  // Prefer children — most text hosts.
  if (fiber.setProp(id, ["children"], text)) return true;
  for (const key of ["title", "label", "text", "value", "placeholder", "alt", "aria-label"]) {
    if (fiber.setProp(id, [key], text)) return true;
  }
  return false;
}
