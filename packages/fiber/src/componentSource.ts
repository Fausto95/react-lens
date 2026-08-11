import type { SourceLocation } from "@reactlens/protocol";
import { describeFunctionFrame, parseFrameLocation, type DispatcherRef } from "./functionFrame.js";

/** How many wrapper layers (memo/forwardRef) to peel before giving up. */
const MAX_UNWRAP = 8;

const FORWARD_REF = Symbol.for("react.forward_ref");
const MEMO = Symbol.for("react.memo");

/**
 * The function that actually carries user code for a component type. React
 * wraps user functions in memo/forwardRef objects created inside React's own
 * module, so locating the wrapper would point at react.js instead of the app.
 */
export function unwrapComponentFunction(type: unknown): ((...args: never[]) => unknown) | null {
  let current = type;
  for (let depth = 0; depth < MAX_UNWRAP; depth++) {
    if (typeof current === "function") return current as (...args: never[]) => unknown;
    if (current === null || typeof current !== "object") return null;
    const obj = current as { $$typeof?: unknown; render?: unknown; type?: unknown };
    const next =
      obj.$$typeof === FORWARD_REF ? obj.render : obj.$$typeof === MEMO ? obj.type : null;
    if (next === null || next === undefined || next === current) return null;
    current = next;
  }
  return null;
}

/**
 * Compiled definition site of a component type — the production-build source
 * signal. `construct` must be true for class components (they are constructed,
 * not called).
 */
export function locateComponentType(
  type: unknown,
  opts: { currentDispatcherRef?: DispatcherRef | null | undefined; construct?: boolean },
): SourceLocation | undefined {
  const fn = unwrapComponentFunction(type);
  if (!fn) return undefined;
  const frame = describeFunctionFrame(fn, opts);
  if (!frame) return undefined;
  const loc = parseFrameLocation(frame);
  return loc ? { file: loc.file, line: loc.line, column: loc.column } : undefined;
}
