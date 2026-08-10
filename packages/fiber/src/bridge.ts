import type {
  ComponentId,
  ComponentType,
  RootId,
  CommitId,
  ComponentInstance,
  CommitInfo,
  CompilerStatus,
  SourceLocation,
} from "@react-lens/protocol";
import { createIdFactory } from "@react-lens/protocol";
import {
  type Fiber,
  type FiberRoot,
  type DevToolsHook,
  type ReactRenderer,
  getExistingHook,
  setHook,
  fiberFromDomNode,
  isComponentTag,
  displayNameOf,
  HostComponent,
  HostRoot,
} from "./react-internals.js";

export type Dispose = () => void;

export interface CommitObservation extends CommitInfo {
  /** Per-rendered-component reasons + timing, derived from the fiber pair. */
  details: Map<ComponentId, RenderDetail>;
}

export interface RenderDetail {
  reason: RenderReasonLite;
  changedPropKeys: string[];
  selfDuration: number;
  totalDuration: number;
  fiber: Fiber;
}

export type RenderReasonLite = "mount" | "props" | "state-or-parent";

export interface FiberBridge {
  install(): void;
  /** Exclude a React root's container from capture (e.g. the panel's own UI). */
  ignoreContainer(node: Node): void;
  resolveComponent(node: Node): ComponentInstance | null;
  domNodesOf(id: ComponentId): Node[];
  getInstance(id: ComponentId): ComponentInstance | undefined;
  getCompilerStatus(id: ComponentId): CompilerStatus;
  reactVersion(): string | null;
  onCommit(cb: (commit: CommitObservation) => void): Dispose;
  onUnmount(cb: (id: ComponentId) => void): Dispose;
}

export function createFiberBridge(target: typeof globalThis = globalThis): FiberBridge {
  const nextComponentId = createIdFactory<ComponentId>();
  const nextComponentType = createIdFactory<ComponentType>();
  const nextRootId = createIdFactory<RootId>();
  const nextCommitId = createIdFactory<CommitId>();

  // Fiber identity survives the current/alternate double-buffer swap: both
  // point at the same logical instance, so we assign one id to the pair.
  const idByFiber = new WeakMap<Fiber, ComponentId>();
  const typeById = new Map<ComponentType, unknown>();
  const typeIdByType = new WeakMap<object, ComponentType>();
  const instanceById = new Map<ComponentId, ComponentInstance>();
  const fiberById = new Map<ComponentId, Fiber>();
  const rootIdByRoot = new WeakMap<FiberRoot, RootId>();

  const commitListeners = new Set<(commit: CommitObservation) => void>();
  const unmountListeners = new Set<(id: ComponentId) => void>();
  const ignoredContainers = new Set<Node>();

  let reactVersion: string | null = null;

  function install(): void {
    const existing = getExistingHook(target);
    if (existing) {
      chain(existing);
      return;
    }
    const hook: DevToolsHook = {
      renderers: new Map<number, ReactRenderer>(),
      supportsFiber: true,
      checkDCE: () => {},
      inject: (renderer) => {
        const id = hook.renderers.size + 1;
        hook.renderers.set(id, renderer);
        if (renderer.version) reactVersion = renderer.version;
        return id;
      },
      onCommitFiberRoot: (_id, root) => handleCommit(root),
      onCommitFiberUnmount: (_id, fiber) => handleUnmount(fiber),
      onPostCommitFiberRoot: () => {},
      _lensChained: false,
    };
    setHook(target, hook);
  }

  /** Cooperate with an already-installed hook rather than clobbering it. */
  function chain(existing: DevToolsHook): void {
    if (existing._lensChained) return;
    for (const r of existing.renderers.values()) {
      if (r.version) reactVersion = r.version;
    }
    const originalCommit = existing.onCommitFiberRoot?.bind(existing);
    const originalUnmount = existing.onCommitFiberUnmount?.bind(existing);
    existing.onCommitFiberRoot = (id, root, priority) => {
      originalCommit?.(id, root, priority);
      handleCommit(root);
    };
    existing.onCommitFiberUnmount = (id, fiber) => {
      originalUnmount?.(id, fiber);
      handleUnmount(fiber);
    };
    existing._lensChained = true;
  }

  function idOf(fiber: Fiber): ComponentId {
    const known = idByFiber.get(fiber) ?? (fiber.alternate ? idByFiber.get(fiber.alternate) : undefined);
    if (known !== undefined) {
      // Ensure both halves of the pair map to the id.
      idByFiber.set(fiber, known);
      if (fiber.alternate) idByFiber.set(fiber.alternate, known);
      return known;
    }
    const id = nextComponentId();
    idByFiber.set(fiber, id);
    if (fiber.alternate) idByFiber.set(fiber.alternate, id);
    return id;
  }

  function typeOf(fiber: Fiber): ComponentType {
    const type = (fiber.type ?? fiber.elementType) as object | null;
    if (type && (typeof type === "object" || typeof type === "function")) {
      const known = typeIdByType.get(type);
      if (known !== undefined) return known;
      const tid = nextComponentType();
      typeIdByType.set(type, tid);
      typeById.set(tid, type);
      return tid;
    }
    const tid = nextComponentType();
    return tid;
  }

  function rootIdOf(root: FiberRoot): RootId {
    const known = rootIdByRoot.get(root);
    if (known !== undefined) return known;
    const id = nextRootId();
    rootIdByRoot.set(root, id);
    return id;
  }

  function buildInstance(fiber: Fiber, rootId: RootId): ComponentInstance {
    const id = idOf(fiber);
    const parentFiber = nearestComponentAncestor(fiber.return);
    const instance: ComponentInstance = {
      id,
      type: typeOf(fiber),
      name: displayNameOf(fiber),
      rootId,
      compiler: detectCompilerStatus(fiber),
    };
    if (parentFiber) instance.parentId = idOf(parentFiber);
    const source = sourceOf(fiber);
    if (source) instance.source = source;
    instanceById.set(id, instance);
    fiberById.set(id, fiber);
    return instance;
  }

  function handleCommit(root: FiberRoot): void {
    if (isIgnoredRoot(root)) return;
    const rootId = rootIdOf(root);
    const details = new Map<ComponentId, RenderDetail>();
    const rendered: ComponentId[] = [];

    traverse(root.current, (fiber) => {
      if (!isComponentTag(fiber.tag)) return;
      const detail = renderDetail(fiber);
      if (!detail) return;
      const id = idOf(fiber);
      buildInstance(fiber, rootId);
      details.set(id, detail);
      rendered.push(id);
    });

    if (rendered.length === 0) return;

    const observation: CommitObservation = {
      commitId: nextCommitId(),
      rootId,
      timestamp: now(),
      rendered,
      details,
    };
    for (const cb of commitListeners) cb(observation);
  }

  function handleUnmount(fiber: Fiber): void {
    const id = idByFiber.get(fiber) ?? (fiber.alternate ? idByFiber.get(fiber.alternate) : undefined);
    if (id === undefined) return;
    instanceById.delete(id);
    fiberById.delete(id);
    for (const cb of unmountListeners) cb(id);
  }

  function resolveComponent(node: Node): ComponentInstance | null {
    let fiber = fiberFromDomNode(node) ?? undefined;
    if (!fiber) return null;
    const component = nearestComponentSelfOrAncestor(fiber);
    if (!component) return null;
    const rootId = rootOf(component);
    return buildInstance(component, rootId);
  }

  function domNodesOf(id: ComponentId): Node[] {
    const fiber = fiberById.get(id);
    if (!fiber) return [];
    const nodes: Node[] = [];
    traverse(fiber, (f) => {
      if (f.tag === HostComponent && f.stateNode instanceof Node) nodes.push(f.stateNode);
    }, /* stopAtHost */ true);
    return nodes;
  }

  function getInstance(id: ComponentId): ComponentInstance | undefined {
    return instanceById.get(id);
  }

  function getCompilerStatus(id: ComponentId): CompilerStatus {
    const fiber = fiberById.get(id);
    return fiber ? detectCompilerStatus(fiber) : { compiled: false, memoized: false };
  }

  function onCommit(cb: (commit: CommitObservation) => void): Dispose {
    commitListeners.add(cb);
    return () => commitListeners.delete(cb);
  }

  function onUnmount(cb: (id: ComponentId) => void): Dispose {
    unmountListeners.add(cb);
    return () => unmountListeners.delete(cb);
  }

  function isIgnoredRoot(root: FiberRoot): boolean {
    if (ignoredContainers.size === 0) return false;
    const container = (root.current.stateNode as { containerInfo?: Node } | null)?.containerInfo;
    if (container && isWithinIgnored(container)) return true;
    return false;
  }

  function isWithinIgnored(node: Node): boolean {
    for (const ignored of ignoredContainers) {
      if (ignored === node || (ignored.contains && ignored.contains(node))) return true;
    }
    return false;
  }

  return {
    install,
    ignoreContainer: (node: Node) => ignoredContainers.add(node),
    resolveComponent,
    domNodesOf,
    getInstance,
    getCompilerStatus,
    reactVersion: () => reactVersion,
    onCommit,
    onUnmount,
  };

  // ── helpers ──────────────────────────────────────────────────────────────

  function rootOf(fiber: Fiber): RootId {
    let node: Fiber | null = fiber;
    while (node && node.tag !== HostRoot && node.return) node = node.return;
    // Without the FiberRoot object we mint a stable id from the top fiber.
    const top = node ?? fiber;
    const known = idByFiber.get(top);
    return (known ?? nextRootId()) as unknown as RootId;
  }
}

function renderDetail(fiber: Fiber): RenderDetail | null {
  const alternate = fiber.alternate;
  const selfDuration = fiber.actualDuration ?? 0;
  const totalDuration = fiber.treeBaseDuration ?? selfDuration;

  if (!alternate) {
    return {
      reason: "mount",
      changedPropKeys: [],
      selfDuration,
      totalDuration,
      fiber,
    };
  }

  const changedPropKeys = shallowChangedKeys(alternate.memoizedProps, fiber.memoizedProps);
  const valuePropsChanged = changedPropKeys.length > 0;

  // In non-profiling builds actualDuration is undefined, so we can't rely on
  // timing to decide whether this fiber committed. React reuses (bails out on)
  // fibers it did not re-render, so a fiber whose props- or state-head identity
  // differs from its alternate is one that actually did work this commit. This
  // keeps render counts meaningful without profiling and without counting the
  // whole (bailed-out) tree.
  const hasTiming = typeof fiber.actualDuration === "number" && fiber.actualDuration > 0;
  const propsIdentityChanged = alternate.memoizedProps !== fiber.memoizedProps;
  const stateChanged = alternate.memoizedState !== fiber.memoizedState;
  if (!hasTiming && !propsIdentityChanged && !stateChanged) return null;

  return {
    reason: valuePropsChanged ? "props" : "state-or-parent",
    changedPropKeys,
    selfDuration,
    totalDuration,
    fiber,
  };
}

function shallowChangedKeys(before: unknown, after: unknown): string[] {
  if (before === after) return [];
  if (!isRecord(before) || !isRecord(after)) return before === after ? [] : ["*"];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (!Object.is(before[k], after[k])) changed.push(k);
  }
  return changed;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function nearestComponentSelfOrAncestor(fiber: Fiber): Fiber | null {
  let node: Fiber | null = fiber;
  while (node) {
    if (isComponentTag(node.tag)) return node;
    node = node.return;
  }
  return null;
}

function nearestComponentAncestor(fiber: Fiber | null): Fiber | null {
  let node = fiber;
  while (node) {
    if (isComponentTag(node.tag)) return node;
    node = node.return;
  }
  return null;
}

function sourceOf(fiber: Fiber): SourceLocation | undefined {
  const dbg = fiber._debugSource;
  if (dbg) return { file: dbg.fileName, line: dbg.lineNumber, column: dbg.columnNumber ?? 0 };
  return undefined;
}

/**
 * Best-effort React Compiler detection. React 19 does not yet expose a stable
 * public marker; we look for the memo-cache hook signature the Compiler emits.
 * When unknown we report `compiled: false` rather than guessing (DESIGN §7).
 */
function detectCompilerStatus(fiber: Fiber): CompilerStatus {
  const state = fiber.memoizedState as { memoizedState?: unknown } | null;
  // The compiler's useMemoCache stores a fixed-size array as the first hook.
  const firstHookValue = state?.memoizedState;
  const compiled = Array.isArray(firstHookValue) && "$" in (firstHookValue as object) === false
    ? looksLikeMemoCache(firstHookValue as unknown[])
    : false;
  return { compiled, memoized: compiled };
}

function looksLikeMemoCache(arr: unknown[]): boolean {
  // useMemoCache initializes every slot to a shared sentinel symbol.
  if (arr.length === 0) return false;
  const sentinel = arr[0];
  return typeof sentinel === "symbol" || arr.every((x) => x === arr[0]);
}

function traverse(root: Fiber, visit: (f: Fiber) => void, stopAtHost = false): void {
  let node: Fiber | null = root;
  // Iterative pre-order walk over child/sibling/return pointers.
  const start = root;
  while (node) {
    visit(node);
    if (node.child && !(stopAtHost && node !== start && node.tag === HostComponent)) {
      node = node.child;
      continue;
    }
    if (node === start) break;
    while (node && !node.sibling) {
      node = node.return;
      if (!node || node === start) return;
    }
    node = node ? node.sibling : null;
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
