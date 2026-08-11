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
export const SuspenseComponent = 13;
export const MemoComponent = 14;
export const SimpleMemoComponent = 15;

/** Fiber flag set during beginWork when a fiber renders (not a bailout). */
export const PERFORMED_WORK = 0b1;

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
  updateQueue: unknown;
  dependencies: unknown;
  flags: number;
  subtreeFlags: number;
  alternate: Fiber | null;
  actualDuration?: number;
  actualStartTime?: number;
  selfBaseDuration?: number;
  treeBaseDuration?: number;
  _debugSource?: { fileName: string; lineNumber: number; columnNumber?: number };
  _debugOwner?: Fiber | null;
  /** React 19: an Error capturing the element's JSX creation site. */
  _debugStack?: unknown;
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
  /**
   * Set by the synchronous document_start stub that wins the hook slot; true
   * only while the stub's buffering handlers are still in place. The first
   * bridge that chains replaces them and clears this.
   */
  _lensStub?: boolean;
  /** Roots the stub buffered before the heavy bridge loaded and chained. */
  _lensQueue?: FiberRoot[];
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

/**
 * Returns the fiber that belongs to the *current* (committed) tree, given
 * either buffer. Ported from React's findCurrentFiberUsingSlowPath. Needed
 * because a targeted update (e.g. overrideProps) bails out ancestors, so
 * traversing `root.current` can reach a stale child fiber whose memoizedProps
 * lag behind the committed DOM — the real one is its alternate.
 */
export function findCurrentFiber(fiber: Fiber): Fiber {
  const alternate = fiber.alternate;
  if (!alternate) return fiber;

  let a: Fiber = fiber;
  let b: Fiber = alternate;
  // Climb until we reach the HostRoot, keeping `a`/`b` as the two buffers.
  for (let guard = 0; guard < 10_000; guard++) {
    const parentA = a.return;
    if (parentA === null) break;
    const parentB = parentA.alternate;
    if (parentB === null) {
      const nextParent = parentA.return;
      if (nextParent !== null) {
        a = nextParent;
        b = nextParent;
        continue;
      }
      break;
    }
    if (parentA.child === parentB.child) {
      let child = parentA.child;
      while (child) {
        if (child === a) return fiber;
        if (child === b) return alternate;
        child = child.sibling;
      }
      return fiber;
    }
    if (a.return !== b.return) {
      a = parentA;
      b = parentB;
    } else {
      let found = false;
      let child = parentA.child;
      while (child) {
        if (child === a) {
          a = parentA;
          b = parentB;
          found = true;
          break;
        }
        if (child === b) {
          b = parentA;
          a = parentB;
          found = true;
          break;
        }
        child = child.sibling;
      }
      if (!found) {
        child = parentB.child;
        while (child) {
          if (child === a) {
            a = parentB;
            b = parentA;
            found = true;
            break;
          }
          if (child === b) {
            b = parentB;
            a = parentA;
            found = true;
            break;
          }
          child = child.sibling;
        }
        if (!found) return fiber;
      }
    }
  }

  if (a.tag === HostRoot) {
    const root = a.stateNode as { current?: Fiber } | null;
    return root && root.current === a ? fiber : alternate;
  }
  return fiber;
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
    const obj = type as {
      displayName?: string;
      render?: { name?: string };
      type?: { name?: string };
    };
    return obj.displayName || obj.render?.name || obj.type?.name || "Anonymous";
  }
  return "Unknown";
}
