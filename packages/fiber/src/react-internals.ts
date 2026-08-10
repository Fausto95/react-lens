/**
 * Minimal structural typing of the React internals we touch. We deliberately
 * model only the fields we read, so a React version bump surfaces here and
 * nowhere else (DESIGN §7: `fiber` is the only module allowed to know these).
 */

export type WorkTag = number;

// react-reconciler WorkTag values (stable across React 18/19).
export const FunctionComponent = 0;
export const ClassComponent = 1;
export const HostRoot = 3;
export const HostComponent = 5;
export const HostText = 6;
export const ContextProvider = 10;
export const ForwardRef = 11;
export const MemoComponent = 14;
export const SimpleMemoComponent = 15;

export interface Fiber {
  tag: WorkTag;
  key: string | null;
  elementType: unknown;
  type: unknown;
  stateNode: unknown;
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  index: number;
  memoizedProps: unknown;
  memoizedState: unknown;
  pendingProps: unknown;
  dependencies: unknown;
  flags: number;
  alternate: Fiber | null;
  actualDuration?: number;
  actualStartTime?: number;
  selfBaseDuration?: number;
  treeBaseDuration?: number;
  _debugSource?: { fileName: string; lineNumber: number; columnNumber?: number };
  _debugOwner?: Fiber | null;
}

export interface FiberRoot {
  current: Fiber;
}

export interface ReactRenderer {
  version?: string;
  bundleType?: number;
  rendererPackageName?: string;
  /** Dev-only live-edit API (present on react-dom development builds). */
  overrideProps?: (fiber: Fiber, path: Array<string | number>, value: unknown) => void;
  overrideHookState?: (
    fiber: Fiber,
    id: number,
    path: Array<string | number>,
    value: unknown,
  ) => void;
  scheduleUpdate?: (fiber: Fiber) => void;
}

export interface DevToolsHook {
  /** Renderer registry, keyed by renderer id. */
  renderers: Map<number, ReactRenderer>;
  supportsFiber: boolean;
  /** React probes this for dead-code-elimination detection. */
  checkDCE: (fn: unknown) => void;
  inject: (renderer: ReactRenderer) => number;
  onCommitFiberRoot: (rendererId: number, root: FiberRoot, priority?: unknown) => void;
  onCommitFiberUnmount: (rendererId: number, fiber: Fiber) => void;
  onPostCommitFiberRoot?: (rendererId: number, root: FiberRoot) => void;
  /** Present when another tool (official DevTools) already installed a hook. */
  _lensChained?: boolean;
}

const HOOK_KEY = "__REACT_DEVTOOLS_GLOBAL_HOOK__";

export function getExistingHook(target: typeof globalThis): DevToolsHook | undefined {
  return (target as Record<string, unknown>)[HOOK_KEY] as DevToolsHook | undefined;
}

export function setHook(target: typeof globalThis, hook: DevToolsHook): void {
  Object.defineProperty(target, HOOK_KEY, {
    value: hook,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}

/** The property React stamps on host DOM nodes pointing back at their fiber. */
export function fiberFromDomNode(node: Node): Fiber | undefined {
  for (const key in node) {
    if (key.startsWith("__reactFiber$")) {
      return (node as unknown as Record<string, Fiber>)[key];
    }
  }
  return undefined;
}

export function isComponentTag(tag: WorkTag): boolean {
  return (
    tag === FunctionComponent ||
    tag === ClassComponent ||
    tag === ForwardRef ||
    tag === MemoComponent ||
    tag === SimpleMemoComponent
  );
}

export function displayNameOf(fiber: Fiber): string {
  const type = fiber.type ?? fiber.elementType;
  if (typeof type === "string") return type;
  if (typeof type === "function") {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || "Anonymous";
  }
  if (type && typeof type === "object") {
    const obj = type as { displayName?: string; render?: { name?: string }; type?: { name?: string } };
    return (
      obj.displayName ||
      obj.render?.name ||
      obj.type?.name ||
      "Anonymous"
    );
  }
  return "Unknown";
}
