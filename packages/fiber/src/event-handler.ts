import { fiberFromDomNode, findCurrentFiber, type Fiber } from "./react-internals.js";

const EVENT_PROPS: Record<string, readonly string[]> = {
  click: ["onClick"],
  dblclick: ["onDoubleClick"],
  keydown: ["onKeyDown", "onKeyPress"],
  keyup: ["onKeyUp"],
  keypress: ["onKeyPress", "onKeyDown"],
  submit: ["onSubmit"],
  input: ["onInput", "onChange"],
  change: ["onChange"],
  focusin: ["onFocus"],
  focusout: ["onBlur"],
  mouseover: ["onMouseEnter", "onMouseOver"],
  mouseout: ["onMouseLeave", "onMouseOut"],
  pointerover: ["onPointerEnter", "onPointerOver"],
  pointerout: ["onPointerLeave", "onPointerOut"],
  pointerdown: ["onPointerDown"],
  pointerup: ["onPointerUp"],
  dragstart: ["onDragStart", "onDrag"],
  drag: ["onDrag"],
  dragend: ["onDragEnd"],
  drop: ["onDrop"],
};

function propsOf(fiber: Fiber): Record<string, unknown> | null {
  const props = fiber.memoizedProps;
  return typeof props === "object" && props !== null ? (props as Record<string, unknown>) : null;
}

function functionLabel(value: unknown): string | undefined {
  if (typeof value !== "function") return undefined;
  const fn = value as { readonly name?: string; displayName?: string };
  const raw = fn.displayName || fn.name;
  if (!raw) return undefined;
  const name = raw.replace(/^bound\s+/, "").trim();
  // One-character names are normally production-minifier artifacts and are
  // less useful than the component/target fallback already captured upstream.
  return name.length > 1 ? name : undefined;
}

/**
 * Resolve the React callback responsible for a DOM interaction without
 * installing wrappers around application handlers.
 *
 * React stores the committed JSX props on the host fiber. Starting at the
 * event target and walking the fiber return chain also handles delegated /
 * bubbling handlers such as a form `onSubmit` above the clicked button.
 * This is interaction-path work only (one short ancestor walk per user event),
 * never render-path work.
 */
export function eventHandlerName(node: Node, eventType: string): string | undefined {
  const initial = fiberFromDomNode(node);
  if (!initial) return undefined;
  const names = EVENT_PROPS[eventType.toLowerCase()] ?? [];
  if (names.length === 0) return undefined;

  let fiber: Fiber | null = findCurrentFiber(initial);
  for (let guard = 0; fiber && guard < 256; guard++, fiber = fiber.return) {
    const props = propsOf(fiber);
    if (!props) continue;
    for (const propName of names) {
      const label = functionLabel(props[propName]);
      if (label) return label;
    }
  }
  return undefined;
}
