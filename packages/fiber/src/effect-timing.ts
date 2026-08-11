import type { ComponentId } from "@reactlens/protocol";
import {
  type Fiber,
  FunctionComponent,
  ForwardRef,
  SimpleMemoComponent,
  PERFORMED_WORK,
} from "./react-internals.js";

export interface TimedEffect {
  componentId: ComponentId;
  hookIndex: number;
  phase: "run" | "cleanup";
  duration: number;
  timestamp: number;
}

interface HookNode {
  memoizedState: unknown;
  next: HookNode | null;
}

interface EffectState {
  tag: number;
  create: unknown;
  deps: unknown[] | null;
  destroy?: unknown;
  inst?: { destroy?: unknown };
  next?: unknown;
  /** Set by us so we don't double-wrap. */
  _lensWrapped?: boolean;
}

const Passive = 0b1000;
const Layout = 0b0100;

/**
 * Wrap passive (and optionally layout) effect create/destroy on fibers that
 * performed work this commit. Wrappers record wall time into `sink` when React
 * later runs them — layout may already have run by onCommitFiberRoot, so
 * passive effects are the reliable timing target.
 */
export function wrapEffectsForTiming(
  root: Fiber,
  idOf: (fiber: Fiber) => ComponentId,
  sink: TimedEffect[],
): void {
  const stack: Fiber[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const performed = (node.flags & PERFORMED_WORK) !== 0 || typeof node.flags !== "number";
    if (performed && isFunctionLike(node.tag)) {
      wrapHookList(node, idOf(node), sink);
    }
    let child = node.child;
    while (child) {
      stack.push(child);
      child = child.sibling;
    }
  }
}

function wrapHookList(fiber: Fiber, componentId: ComponentId, sink: TimedEffect[]): void {
  let node = fiber.memoizedState as HookNode | null;
  let index = 0;
  while (node && index < 200) {
    const state = node.memoizedState;
    if (isEffect(state) && !state._lensWrapped) {
      // Prefer passive; also wrap layout so we catch what we can.
      if (isPassiveOrLayout(state.tag)) {
        wrapOne(state, componentId, index, sink);
        state._lensWrapped = true;
      }
    }
    node = node.next;
    index++;
  }
}

function wrapOne(
  effect: EffectState,
  componentId: ComponentId,
  hookIndex: number,
  sink: TimedEffect[],
): void {
  const originalCreate = effect.create;
  if (typeof originalCreate === "function") {
    effect.create = function lensTimedCreate(this: unknown, ...args: unknown[]) {
      const t0 = performance.now();
      try {
        const result = (originalCreate as (...a: unknown[]) => unknown).apply(this, args);
        // React 19: create may return destroy; older: destroy on effect/inst.
        if (typeof result === "function") {
          return wrapDestroy(result as (...a: unknown[]) => unknown, componentId, hookIndex, sink);
        }
        return result;
      } finally {
        sink.push({
          componentId,
          hookIndex,
          phase: "run",
          duration: performance.now() - t0,
          timestamp: performance.now(),
        });
      }
    };
  }

  const existingDestroy =
    (typeof effect.destroy === "function" ? effect.destroy : undefined) ??
    (typeof effect.inst?.destroy === "function" ? effect.inst.destroy : undefined);
  if (typeof existingDestroy === "function") {
    const wrapped = wrapDestroy(existingDestroy as (...a: unknown[]) => unknown, componentId, hookIndex, sink);
    if (effect.inst && typeof effect.inst === "object") {
      effect.inst.destroy = wrapped;
    } else {
      effect.destroy = wrapped;
    }
  }
}

function wrapDestroy(
  original: (...a: unknown[]) => unknown,
  componentId: ComponentId,
  hookIndex: number,
  sink: TimedEffect[],
): (...a: unknown[]) => unknown {
  return function lensTimedDestroy(this: unknown, ...args: unknown[]) {
    const t0 = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      sink.push({
        componentId,
        hookIndex,
        phase: "cleanup",
        duration: performance.now() - t0,
        timestamp: performance.now(),
      });
    }
  };
}

function isFunctionLike(tag: number): boolean {
  return tag === FunctionComponent || tag === ForwardRef || tag === SimpleMemoComponent;
}

function isEffect(state: unknown): state is EffectState {
  return (
    typeof state === "object" &&
    state !== null &&
    "create" in state &&
    "deps" in state &&
    "tag" in state
  );
}

function isPassiveOrLayout(tag: number): boolean {
  return (tag & Passive) !== 0 || (tag & Layout) !== 0;
}
