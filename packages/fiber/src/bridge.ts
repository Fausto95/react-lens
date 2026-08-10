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
  findCurrentFiber,
  HostComponent,
  HostRoot,
  SuspenseComponent,
  PERFORMED_WORK,
} from "./react-internals.js";
import { wrapEffectsForTiming, type TimedEffect } from "./effect-timing.js";

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
  /** Whether the renderer exposes the dev-only live-edit API. */
  canEditValues(): boolean;
  /** Override a prop at `path` on a component and schedule a re-render. */
  setProp(id: ComponentId, path: Array<string | number>, value: unknown): boolean;
  /** Override a hook's state at `path` (hookIndex from the snapshot). */
  setHookState(
    id: ComponentId,
    hookIndex: number,
    path: Array<string | number>,
    value: unknown,
  ): boolean;
  resolveComponent(node: Node): ComponentInstance | null;
  domNodesOf(id: ComponentId): Node[];
  getInstance(id: ComponentId): ComponentInstance | undefined;
  getCompilerStatus(id: ComponentId): CompilerStatus;
  reactVersion(): string | null;
  onCommit(cb: (commit: CommitObservation) => void): Dispose;
  onUnmount(cb: (id: ComponentId) => void): Dispose;
  /** Fired after passive effects flush; carries timed effect observations. */
  onPostCommit(cb: (obs: PostCommitObservation) => void): Dispose;
}

export interface PostCommitObservation {
  rootId: RootId;
  timestamp: number;
  effects: import("./effect-timing.js").TimedEffect[];
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
  const postCommitListeners = new Set<(obs: PostCommitObservation) => void>();
  const ignoredContainers = new Set<Node>();
  /** Effect timings collected between commit and post-commit for the active root. */
  let pendingEffectTimings: TimedEffect[] = [];
  let pendingPostCommitRootId: RootId | null = null;

  let reactVersion: string | null = null;
  let activeHook: DevToolsHook | null = null;
  // The renderer react-dom passes to inject(), captured directly — some host
  // hooks (e.g. Vite's Fast Refresh stub) don't store it in `renderers`.
  let injectedRenderer: ReactRenderer | null = null;

  function captureRenderer(renderer: ReactRenderer): void {
    injectedRenderer = renderer;
    if (renderer.version) reactVersion = renderer.version;
  }

  function install(): void {
    const existing = getExistingHook(target);
    if (existing) {
      activeHook = existing;
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
        captureRenderer(renderer);
        return id;
      },
      onCommitFiberRoot: (_id, root) => handleCommit(root),
      onCommitFiberUnmount: (_id, fiber) => handleUnmount(fiber),
      onPostCommitFiberRoot: (_id, root) => handlePostCommit(root),
      _lensChained: false,
    };
    activeHook = hook;
    setHook(target, hook);
  }

  /** The renderer that exposes the live-edit API (dev builds only). */
  function getRenderer(): ReactRenderer | undefined {
    if (injectedRenderer?.overrideProps || injectedRenderer?.overrideHookState) {
      return injectedRenderer;
    }
    for (const renderer of activeHook?.renderers.values() ?? []) {
      if (renderer.overrideProps || renderer.overrideHookState) return renderer;
    }
    return injectedRenderer ?? undefined;
  }

  function canEditValues(): boolean {
    const renderer = getRenderer();
    return Boolean(renderer?.overrideProps && renderer?.overrideHookState);
  }

  function setProp(id: ComponentId, path: Array<string | number>, value: unknown): boolean {
    const fiber = fiberById.get(id);
    const renderer = getRenderer();
    if (!fiber || !renderer?.overrideProps) return false;
    renderer.overrideProps(currentOf(fiber), path, value);
    return true;
  }

  function setHookState(
    id: ComponentId,
    hookIndex: number,
    path: Array<string | number>,
    value: unknown,
  ): boolean {
    const fiber = fiberById.get(id);
    const renderer = getRenderer();
    if (!fiber || !renderer?.overrideHookState) return false;
    renderer.overrideHookState(currentOf(fiber), hookIndex, path, value);
    return true;
  }

  /** Prefer the committed (current) fiber for edits, not a stale alternate. */
  function currentOf(fiber: Fiber): Fiber {
    return findCurrentFiber(fiber);
  }

  /**
   * Cooperate with an already-installed hook rather than clobbering it. This is
   * the normal path in the extension: our zero-import stub wins the hook slot at
   * document_start and buffers commits; the heavy bridge loads later and chains.
   * It also chains the official React DevTools hook when that's present instead.
   */
  function chain(existing: DevToolsHook): void {
    if (existing._lensChained) return;
    const isStub = existing._lensStub === true;
    // A renderer may already be registered; otherwise capture it at inject time.
    for (const r of existing.renderers.values()) captureRenderer(r);
    const originalInject = existing.inject?.bind(existing);
    existing.inject = (renderer) => {
      captureRenderer(renderer);
      return originalInject ? originalInject(renderer) : 0;
    };
    // The stub's only job was buffering, so don't keep forwarding to it — that
    // would grow its queue forever. A real peer hook, though, must keep working.
    const originalCommit = isStub ? undefined : existing.onCommitFiberRoot?.bind(existing);
    const originalUnmount = isStub ? undefined : existing.onCommitFiberUnmount?.bind(existing);
    const originalPost = isStub ? undefined : existing.onPostCommitFiberRoot?.bind(existing);
    existing.onCommitFiberRoot = (id, root, priority) => {
      originalCommit?.(id, root, priority);
      handleCommit(root);
    };
    existing.onCommitFiberUnmount = (id, fiber) => {
      originalUnmount?.(id, fiber);
      handleUnmount(fiber);
    };
    existing.onPostCommitFiberRoot = (id, root) => {
      originalPost?.(id, root);
      handlePostCommit(root);
    };
    existing._lensChained = true;

    // Replay commits the stub captured before we loaded — this is what makes the
    // already-mounted tree appear the moment the panel connects. Fibers mutate
    // in place, so every buffered entry for a given root now points at the same
    // final tree; replaying each would fabricate dozens of phantom commits. So
    // we replay each distinct root exactly once (its current, settled state).
    const queue = existing._lensQueue;
    if (Array.isArray(queue) && queue.length > 0) {
      const roots = queue.slice();
      queue.length = 0;
      const seen = new Set<FiberRoot>();
      for (const root of roots) {
        if (seen.has(root)) continue;
        seen.add(root);
        handleCommit(root);
      }
    }
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
    const kind = detectKind(fiber);
    const instance: ComponentInstance = {
      id,
      type: typeOf(fiber),
      name: kind === "suspense" ? "Suspense" : displayNameOf(fiber),
      rootId,
      compiler: detectCompilerStatus(fiber),
      kind,
    };
    const rsc = flightMeta(fiber.elementType) ?? flightMeta(fiber.type);
    if (rsc) instance.rsc = rsc;
    if (parentFiber) instance.parentId = idOf(parentFiber);
    const source = sourceOf(fiber);
    if (source) instance.source = source;
    const suspense = suspenseOf(fiber);
    if (suspense.under && suspense.boundary) {
      instance.underSuspense = true;
      if (suspense.suspended) instance.suspended = true;
      // Register the boundary as its own instance so Relations / badges can name it.
      const boundary = buildBoundaryInstance(suspense.boundary, rootId, suspense.suspended);
      instance.suspenseBoundaryId = boundary.id;
    }
    instanceById.set(id, instance);
    fiberById.set(id, fiber);
    return instance;
  }

  function buildBoundaryInstance(
    fiber: Fiber,
    rootId: RootId,
    suspended: boolean,
  ): ComponentInstance {
    const id = idOf(fiber);
    const existing = instanceById.get(id);
    if (existing) {
      existing.suspended = suspended;
      existing.kind = "suspense";
      return existing;
    }
    const instance: ComponentInstance = {
      id,
      type: typeOf(fiber),
      name: "Suspense",
      rootId,
      compiler: { compiled: false, memoized: false },
      kind: "suspense",
      suspended,
    };
    instanceById.set(id, instance);
    fiberById.set(id, fiber);
    return instance;
  }

  function handleCommit(root: FiberRoot): void {
    if (isIgnoredRoot(root)) return;
    const rootId = rootIdOf(root);
    const details = new Map<ComponentId, RenderDetail>();
    const rendered: ComponentId[] = [];

    walkRendered(root.current, (fiber) => {
      const detail = renderInfo(fiber);
      const id = idOf(fiber);
      buildInstance(fiber, rootId);
      details.set(id, detail);
      rendered.push(id);
    });

    if (rendered.length === 0) return;

    // Wrap passive effect create/destroy so post-commit can report real durations.
    pendingEffectTimings = [];
    pendingPostCommitRootId = rootId;
    wrapEffectsForTiming(root.current, idOf, pendingEffectTimings);

    const observation: CommitObservation = {
      commitId: nextCommitId(),
      rootId,
      timestamp: now(),
      rendered,
      details,
    };
    for (const cb of commitListeners) cb(observation);
  }

  function handlePostCommit(root: FiberRoot): void {
    if (isIgnoredRoot(root)) return;
    const effects = pendingEffectTimings;
    const rootId = pendingPostCommitRootId ?? rootIdOf(root);
    pendingEffectTimings = [];
    pendingPostCommitRootId = null;
    if (effects.length === 0 && postCommitListeners.size === 0) return;
    const obs: PostCommitObservation = {
      rootId,
      timestamp: now(),
      effects: effects.slice(),
    };
    for (const cb of postCommitListeners) cb(obs);
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
    const collect = (stopAtHost: boolean) => {
      traverse(fiber, (f) => {
        if (f.tag === HostComponent && f.stateNode instanceof Node) nodes.push(f.stateNode);
      }, stopAtHost);
    };
    collect(true);
    if (nodes.length === 0) collect(false);
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

  function onPostCommit(cb: (obs: PostCommitObservation) => void): Dispose {
    postCommitListeners.add(cb);
    return () => postCommitListeners.delete(cb);
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
    canEditValues,
    setProp,
    setHookState,
    resolveComponent,
    domNodesOf,
    getInstance,
    getCompilerStatus,
    reactVersion: () => reactVersion,
    onCommit,
    onUnmount,
    onPostCommit,
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

/**
 * Visits exactly the component fibers that performed work in this commit.
 * React clears the PerformedWork flag when it clones a fiber for a commit and
 * sets it only on fibers that actually render; it also propagates the bit into
 * each ancestor's `subtreeFlags`. So we descend only where `subtreeFlags` has
 * work and count only fibers whose own `flags` have it — which prunes
 * bailed-out subtrees entirely and never reads their stale fibers. Falls back
 * to visiting everything when these fields are unavailable (non-dev builds).
 */
function walkRendered(root: Fiber, visit: (f: Fiber) => void): void {
  const hasFlags = typeof root.subtreeFlags === "number";
  const stack: Fiber[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const performed = !hasFlags || (node.flags & PERFORMED_WORK) !== 0;
    if (performed && isComponentTag(node.tag)) visit(node);

    // Descend only where a descendant actually rendered — keeps us out of
    // bailed subtrees (whose fibers carry stale flags).
    const descend = !hasFlags || (node.subtreeFlags & PERFORMED_WORK) !== 0;
    if (!descend) continue;
    // Push children in reverse so they pop in natural (pre-order) sequence.
    const kids: Fiber[] = [];
    let child = node.child;
    while (child) {
      kids.push(child);
      child = child.sibling;
    }
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
}

/** Reason + timing for a fiber already known to have rendered this commit. */
function renderInfo(fiber: Fiber): RenderDetail {
  const alternate = fiber.alternate;
  const selfDuration = typeof fiber.actualDuration === "number" ? fiber.actualDuration : 0;
  const totalDuration = fiber.treeBaseDuration ?? selfDuration;

  if (!alternate) {
    return { reason: "mount", changedPropKeys: [], selfDuration, totalDuration, fiber };
  }
  const changedPropKeys = shallowChangedKeys(alternate.memoizedProps, fiber.memoizedProps);
  return {
    reason: changedPropKeys.length > 0 ? "props" : "state-or-parent",
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

/**
 * Nearest <Suspense> ancestor: whether the component is under one, and whether
 * that boundary is currently showing its fallback (React stores a non-null
 * memoizedState on a suspended Suspense fiber).
 */
function suspenseOf(
  fiber: Fiber,
): { under: boolean; suspended: boolean; boundary: Fiber | null } {
  let node: Fiber | null = fiber.return;
  let guard = 0;
  while (node && guard++ < 1000) {
    if (node.tag === SuspenseComponent) {
      return { under: true, suspended: node.memoizedState != null, boundary: node };
    }
    node = node.return;
  }
  return { under: false, suspended: false, boundary: null };
}

/** Heuristic role for Suspense / RSC client & server references. */
function detectKind(fiber: Fiber): NonNullable<ComponentInstance["kind"]> {
  if (fiber.tag === SuspenseComponent) return "suspense";
  const candidates = [fiber.elementType, fiber.type];
  for (const t of candidates) {
    const role = flightRole(t);
    if (role) return "server-boundary";
  }
  return "component";
}

const CLIENT_REF = Symbol.for("react.client.reference");
const SERVER_REF = Symbol.for("react.server.reference");
const LAZY = Symbol.for("react.lazy");

function flightRole(
  t: unknown,
): "client-reference" | "server-reference" | "lazy-payload" | null {
  if (!t || (typeof t !== "object" && typeof t !== "function")) return null;
  const o = t as Record<string | symbol, unknown>;
  const typeOf = o["$$typeof"];
  if (typeOf === CLIENT_REF) return "client-reference";
  if (typeOf === SERVER_REF) return "server-reference";
  if (typeOf === LAZY && ("_payload" in o || "$$id" in o)) return "lazy-payload";
  // Bundler-shaped client refs without a recognizable symbol (older Next).
  if ("$$typeof" in o && ("$$id" in o || "$$async" in o || "$$bundles" in o || "$$name" in o)) {
    return "client-reference";
  }
  return null;
}

function flightMeta(t: unknown): ComponentInstance["rsc"] | undefined {
  const role = flightRole(t);
  if (!role) return undefined;
  if (!t || typeof t !== "object") return { role };
  const o = t as Record<string, unknown>;
  return {
    role,
    ...(typeof o.$$id === "string" ? { moduleId: o.$$id } : {}),
    ...(typeof o.$$name === "string" ? { exportName: o.$$name } : {}),
  };
}

function sourceOf(fiber: Fiber): SourceLocation | undefined {
  // Older React exposed _debugSource directly (the definition site).
  const dbg = fiber._debugSource;
  if (dbg) return { file: dbg.fileName, line: dbg.lineNumber, column: dbg.columnNumber ?? 0 };
  // React 19: parse the JSX creation site out of the captured _debugStack.
  const stack = stackString(fiber._debugStack);
  if (stack) return parseStackSource(stack);
  return undefined;
}

function stackString(debugStack: unknown): string | undefined {
  if (typeof debugStack === "string") return debugStack;
  if (debugStack && typeof debugStack === "object" && "stack" in debugStack) {
    const s = (debugStack as { stack?: unknown }).stack;
    return typeof s === "string" ? s : undefined;
  }
  return undefined;
}

const SKIP_FRAME = /node_modules|react-dom|\breact\b\/|\/@|react_|chunk-|react-refresh|<anonymous>/;

/** Best-effort: first app-owned frame in a captured stack → file:line:col. */
function parseStackSource(stack: string): SourceLocation | undefined {
  for (const line of stack.split("\n")) {
    if (SKIP_FRAME.test(line)) continue;
    const m = /\(?((?:https?:\/\/[^\s)]+?)|(?:\/[^\s)]+?)):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m) continue;
    // Keep the full origin (http://host:port/…): the panel is a different
    // origin in the extension and must fetch the source by absolute URL, not a
    // bare pathname (which would resolve against chrome-extension:// → 404).
    const file = m[1]!.split("?")[0]!;
    return { file, line: Number(m[2]), column: Number(m[3]) };
  }
  return undefined;
}

/**
 * React Compiler detection. The compiler emits `useMemoCache`, which stores its
 * cache on `fiber.updateQueue.memoCache` — a reliable, direct signal that the
 * component was compiled. When absent we report `compiled: false` (DESIGN §7).
 */
function detectCompilerStatus(fiber: Fiber): CompilerStatus {
  const queue = fiber.updateQueue as { memoCache?: unknown } | null;
  const compiled = queue != null && queue.memoCache != null;
  return { compiled, memoized: compiled };
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
