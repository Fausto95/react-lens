import type { HookKind } from "@reactlens/protocol";
import {
  type Fiber,
  ClassComponent,
  FunctionComponent,
  ForwardRef,
  SimpleMemoComponent,
} from "./react-internals.js";

/**
 * Raw (unserialized) hook extracted from a fiber's hook list. The instrumentation
 * layer serializes `value`/`deps` before they leave the page.
 *
 * React does not tag hooks with their type, so `kind` is inferred from the
 * memoizedState shape. This is best-effort and deliberately conservative:
 * unknown shapes are reported as "other" rather than guessed.
 */
export interface RawHook {
  index: number;
  kind: HookKind;
  value?: unknown;
  deps?: unknown[] | null;
}

export interface RawContext {
  displayName?: string;
  value: unknown;
}

interface HookNode {
  memoizedState: unknown;
  queue: unknown;
  next: HookNode | null;
  baseState?: unknown;
}

interface EffectState {
  tag: number;
  create: unknown;
  deps: unknown[] | null;
  next?: unknown;
}

const REACT_MEMO_CACHE_SENTINEL = Symbol.for("react.memo_cache_sentinel");

/** Class components keep state on the instance, not a hook list. */
export function inspectClassState(fiber: Fiber): unknown {
  if (fiber.tag !== ClassComponent) return undefined;
  const instance = fiber.stateNode as { state?: unknown } | null;
  return instance?.state;
}

export function inspectHooks(fiber: Fiber): RawHook[] {
  if (!isFunctionLike(fiber.tag)) return [];
  const first = fiber.memoizedState as HookNode | null;
  if (!first || !isHookNode(first)) return [];

  const hooks: RawHook[] = [];
  let node: HookNode | null = first;
  let index = 0;
  // Guard against corrupt/cyclic lists.
  while (node && index < 200) {
    // Skip the React Compiler's memo-cache hook — it's plumbing, not a user hook.
    if (!isMemoCache(node.memoizedState)) {
      hooks.push(classify(node, index));
    }
    node = node.next;
    index++;
  }
  return hooks;
}

/**
 * Raw state/reducer hook value captured for time travel. `index` is the raw
 * position in the fiber's hook list — exactly what `overrideHookState` expects
 * (React's findHook walks `hook.next` that many times).
 */
export interface CapturedHookState {
  index: number;
  value: unknown;
}

/**
 * Raw references (not serialized, not cloned) of every state/reducer hook.
 * Uses the same list walk and index accounting as `inspectHooks` so a captured
 * index can be replayed through `setHookState` later.
 */
export function captureStateHooks(fiber: Fiber): CapturedHookState[] {
  if (!isFunctionLike(fiber.tag)) return [];
  const first = fiber.memoizedState as HookNode | null;
  if (!first || !isHookNode(first)) return [];

  const captured: CapturedHookState[] = [];
  let node: HookNode | null = first;
  let index = 0;
  while (node && index < 200) {
    if (isStateHook(node)) captured.push({ index, value: node.memoizedState });
    node = node.next;
    index++;
  }
  return captured;
}

/** useState/useReducer: a dispatch queue and a memoizedState that isn't hook plumbing. */
function isStateHook(node: HookNode): boolean {
  if (node.queue == null) return false;
  const state = node.memoizedState;
  return !isEffect(state) && !isMemoCache(state);
}

function classify(node: HookNode, index: number): RawHook {
  const state = node.memoizedState;

  // Effect: memoizedState is an effect object with create/deps (+ a tag).
  if (isEffect(state)) {
    const kind: HookKind = isLayoutEffectTag(state.tag) ? "layout-effect" : "effect";
    return { index, kind, deps: state.deps ?? null };
  }

  // useRef: { current: ... } and no update queue.
  if (isRefLike(state) && node.queue == null) {
    return { index, kind: "ref", value: (state as { current: unknown }).current };
  }

  // useMemo / useCallback: [value, deps].
  if (isMemoTuple(state)) {
    const [value, deps] = state as [unknown, unknown[]];
    const kind: HookKind = typeof value === "function" ? "callback" : "memo";
    return { index, kind, value, deps };
  }

  // useState / useReducer: has a dispatch queue; memoizedState is the value.
  // React doesn't tag which — distinguish by probing lastRenderedReducer:
  // useState's basicStateReducer returns the action when it isn't a function.
  if (node.queue != null) {
    const kind: HookKind = isBasicStateReducer(node.queue) ? "state" : "reducer";
    return { index, kind, value: state };
  }

  // useContext leaves no hook state node in most React builds; a bare value
  // with no queue is reported generically.
  return { index, kind: "other", value: state };
}

export function inspectContexts(fiber: Fiber): RawContext[] {
  return listContextDeps(fiber).map((dep) => ({
    displayName: contextDisplayName(dep.context),
    value: dep.memoizedValue,
  }));
}

/**
 * Contexts whose memoized value changed vs the alternate fiber. Used to tell
 * a real context update apart from "state-or-parent" when the fiber bridge
 * can't see React's context bit.
 */
export function changedContexts(fiber: Fiber): RawContext[] {
  const curr = listContextDeps(fiber);
  if (curr.length === 0) return [];
  const prev = listContextDeps(fiber.alternate);
  const out: RawContext[] = [];
  for (const dep of curr) {
    const before = prev.find((p) => p.context === dep.context);
    if (!before || !Object.is(before.memoizedValue, dep.memoizedValue)) {
      out.push({
        displayName: contextDisplayName(dep.context),
        value: dep.memoizedValue,
      });
    }
  }
  return out;
}

function listContextDeps(fiber: Fiber | null | undefined): ContextDep[] {
  if (!fiber) return [];
  const deps = fiber.dependencies as { firstContext?: ContextDep | null } | null;
  const firstContext = deps?.firstContext;
  if (!firstContext) return [];
  const out: ContextDep[] = [];
  let dep: ContextDep | null = firstContext;
  let guard = 0;
  while (dep && guard < 100) {
    out.push(dep);
    dep = dep.next;
    guard++;
  }
  return out;
}

interface ContextDep {
  context: unknown;
  memoizedValue: unknown;
  next: ContextDep | null;
}

function contextDisplayName(context: unknown): string | undefined {
  if (context && typeof context === "object") {
    const c = context as { displayName?: string; _currentValue?: unknown };
    if (typeof c.displayName === "string") return c.displayName;
  }
  return undefined;
}

function isFunctionLike(tag: number): boolean {
  return tag === FunctionComponent || tag === ForwardRef || tag === SimpleMemoComponent;
}

function isHookNode(value: unknown): value is HookNode {
  return typeof value === "object" && value !== null && "memoizedState" in value && "next" in value;
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

// React effect fiber flags: Layout effects carry the Layout tag bit (0b0100).
function isLayoutEffectTag(tag: number): boolean {
  return (tag & 0b0100) !== 0;
}

function isRefLike(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "current" in state &&
    Object.keys(state as object).length === 1
  );
}

function isMemoCache(state: unknown): boolean {
  return Array.isArray(state) && state.some((x) => x === REACT_MEMO_CACHE_SENTINEL);
}

/**
 * useState installs React's basicStateReducer, which returns a non-function
 * action as-is. User reducers almost never do — probe with a sentinel.
 */
function isBasicStateReducer(queue: unknown): boolean {
  if (!queue || typeof queue !== "object") return true;
  const reducer = (queue as { lastRenderedReducer?: unknown }).lastRenderedReducer;
  if (typeof reducer !== "function") return true;
  const sentinel = {};
  try {
    return (reducer as (s: unknown, a: unknown) => unknown)(null, sentinel) === sentinel;
  } catch {
    return false;
  }
}

function isMemoTuple(state: unknown): boolean {
  if (!Array.isArray(state) || state.length !== 2) return false;
  const deps = state[1];
  // The compiler's memo cache is a flat array seeded with a sentinel — exclude.
  if (state[0] === REACT_MEMO_CACHE_SENTINEL) return false;
  return deps === null || Array.isArray(deps);
}
