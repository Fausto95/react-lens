import type {
  LensEvent,
  RenderEvent,
  EffectEvent,
  RenderReason,
  InteractionEvent,
  ComponentId,
  ComponentInstance,
  CommitSnapshot,
  RenderSnapshot,
  RenderId,
  EventId,
  InteractionId,
  EffectId,
  EventsBatchMessage,
  HookSnapshot,
  SerializedValue,
} from "@react-lens/protocol";
import { createIdFactory } from "@react-lens/protocol";
import type { ContextSnapshot } from "@react-lens/protocol";
import type { FiberBridge, CommitObservation, RenderDetail, RawHook } from "@react-lens/fiber";
import { inspectHooks, inspectContexts, inspectClassState } from "@react-lens/fiber";
import type { Serializer } from "@react-lens/serializer";
import { snapshotDom } from "./dom-snapshot.js";
import { createTimeTravel, type TimeTravelController } from "./time-travel.js";

export interface CaptureConfig {
  captureDOM: boolean;
  /** Ms after a user event during which renders are attributed to it. */
  interactionWindowMs: number;
  onFrame: (frame: EventsBatchMessage["payload"]) => void;
  /**
   * Stream full per-render snapshots (props/hooks/state/context/DOM) inline.
   * Cheap for small apps; ruinous for large ones — a single mount commit of a
   * few thousand components produces tens of MB. When false, only render events
   * and instances stream (enough for the tree/timeline) and snapshots are built
   * lazily via `snapshot(renderId)`. Defaults to true.
   */
  streamSnapshots?: boolean;
  /**
   * Keep raw state references per render for time travel (dev builds only).
   * Opt-out for memory-sensitive pages. Defaults to true.
   */
  captureStateHistory?: boolean;
  /** Optional overhead telemetry sink. */
  onOverhead?: (report: { cpuPercent: number; bytesApprox: number; eventsPerSec: number }) => void;
}

const DEFAULT_CONFIG: Omit<CaptureConfig, "onFrame"> = {
  captureDOM: true,
  interactionWindowMs: 200,
  streamSnapshots: true,
};

export interface Instrumentation {
  start(config: CaptureConfig): void;
  stop(): void;
  isRecording(): boolean;
  /**
   * Build a snapshot on demand for a render still retained in the ring buffer.
   * Used when snapshots aren't streamed inline (large apps): the panel requests
   * the selected render's detail lazily. Returns undefined once evicted.
   */
  snapshot(renderId: RenderId): RenderSnapshot | undefined;
  /** Page-side time travel: apply/goLive raw state captured per render. */
  timeTravel: TimeTravelController;
}

const INTERACTION_EVENTS = ["click", "keydown", "submit"] as const;

export function createInstrumentation(deps: {
  fiber: FiberBridge;
  serializer: Serializer;
}): Instrumentation {
  const { fiber, serializer } = deps;
  const nextEventId = createIdFactory<EventId>();
  const nextRenderId = createIdFactory<RenderId>();
  const nextInteractionId = createIdFactory<InteractionId>();
  const nextEffectId = createIdFactory<EffectId>();

  let recording = false;
  let config: CaptureConfig | null = null;
  let disposeCommit: (() => void) | null = null;
  let disposePostCommit: (() => void) | null = null;
  const listenerCleanups: Array<() => void> = [];

  // Pending frame buffer — batched, never one message per event.
  let pendingEvents: LensEvent[] = [];
  let pendingSnapshots: RenderSnapshot[] = [];
  let pendingInstances = new Map<ComponentId, ComponentInstance>();
  let pendingCommitSnapshots: CommitSnapshot[] = [];
  let lastCommitDomAt = -Infinity;
  let flushScheduled = false;

  let currentInteraction: { id: InteractionId; until: number } | null = null;

  const timeTravel = createTimeTravel({ fiber });

  // Retained render details for on-demand snapshot building when snapshots
  // aren't streamed inline. Bounded ring: recent renders only.
  const retained = new Map<
    RenderId,
    { componentId: ComponentId; detail: RenderDetail; timestamp: number }
  >();
  // Generous: entries are light (a fiber reference + timing), and large apps
  // mount several thousand components in one commit — too small a ring would
  // evict early components' only render before they can be inspected.
  const RETAIN_MAX = 20000;
  /** At most one whole-page DOM capture per this window (trailing). */
  const COMMIT_DOM_THROTTLE_MS = 250;
  /** Page-wide budget: deeper/wider than the per-render default. */
  const COMMIT_DOM_LIMITS = { maxDepth: 12, maxChildren: 64 };

  // Overhead accounting.
  let cpuTimeMs = 0;
  let windowStart = now();
  let eventsInWindow = 0;
  let bytesInWindow = 0;

  function start(userConfig: CaptureConfig): void {
    if (recording) return;
    config = { ...DEFAULT_CONFIG, ...userConfig };
    recording = true;
    // Subscribe BEFORE install: install() may synchronously replay commits a
    // document_start stub buffered before the bridge loaded (the extension's
    // initial-mount tree). Installing first would fire that replay into no
    // listener and lose the mounted tree entirely.
    disposeCommit = fiber.onCommit(handleCommit);
    disposePostCommit = fiber.onPostCommit(handlePostCommit);
    fiber.install();
    attachInteractionListeners();
    windowStart = now();
  }

  function stop(): void {
    if (!recording) return;
    recording = false;
    disposeCommit?.();
    disposeCommit = null;
    disposePostCommit?.();
    disposePostCommit = null;
    for (const cleanup of listenerCleanups) cleanup();
    listenerCleanups.length = 0;
    timeTravel.clear();
    flush();
  }

  function isRecording(): boolean {
    return recording;
  }

  function handleCommit(commit: CommitObservation): void {
    if (!recording || !config) return;
    // A time-travel apply flushes through the same reconciler this bridge
    // observes. While traveling, nothing enters the event log — neither the
    // synthetic restore commits nor interactions with the rewound UI.
    if (timeTravel.isActive()) return;
    const t0 = now();
    const renderedSet = new Set(commit.rendered);
    const interactionId = activeInteractionId();

    captureCommitDom(commit);
    for (const id of commit.rendered) {
      const detail = commit.details.get(id);
      const instance = fiber.getInstance(id);
      if (!detail || !instance) continue;

      pendingInstances.set(id, instance);

      const renderId = nextRenderId();
      const reasons = deriveReasons(detail, instance, renderedSet);
      const event: RenderEvent = {
        id: nextEventId(),
        type: "render",
        timestamp: commit.timestamp,
        componentId: id,
        renderId,
        commitId: commit.commitId,
        selfDuration: detail.selfDuration,
        totalDuration: detail.totalDuration,
        reasons,
        compiler: instance.compiler,
        ...(interactionId !== null ? { interactionId } : {}),
      };
      pendingEvents.push(event);
      if (config.streamSnapshots !== false) {
        pendingSnapshots.push(buildSnapshot(id, renderId, detail, commit.timestamp));
      } else {
        retain(renderId, id, detail, commit.timestamp);
      }
      if (config.captureStateHistory !== false) {
        timeTravel.capture(renderId, id, detail.fiber);
      }
    }

    cpuTimeMs += now() - t0;
    scheduleFlush();
  }

  /**
   * Throttled whole-page DOM per commit — the offline replay substrate for
   * exported sessions. Trailing capture: at most one snapshot per
   * COMMIT_DOM_THROTTLE_MS, taken at the newest commit inside the window.
   */
  function captureCommitDom(commit: CommitObservation): void {
    if (!config?.captureDOM || !commit.container) return;
    if (commit.timestamp - lastCommitDomAt < COMMIT_DOM_THROTTLE_MS) return;
    const dom = snapshotDom(commit.container, COMMIT_DOM_LIMITS);
    if (!dom) return;
    lastCommitDomAt = commit.timestamp;
    pendingCommitSnapshots.push({ commitId: commit.commitId, timestamp: commit.timestamp, dom });
  }

  function retain(
    renderId: RenderId,
    componentId: ComponentId,
    detail: RenderDetail,
    timestamp: number,
  ): void {
    retained.set(renderId, { componentId, detail, timestamp });
    if (retained.size > RETAIN_MAX) {
      const oldest = retained.keys().next().value;
      if (oldest !== undefined) retained.delete(oldest);
    }
  }

  /** On-demand snapshot for a retained render (see Instrumentation.snapshot). */
  function snapshot(renderId: RenderId): RenderSnapshot | undefined {
    const held = retained.get(renderId);
    if (!held) return undefined;
    return buildSnapshot(held.componentId, renderId, held.detail, held.timestamp);
  }

  function buildSnapshot(
    id: ComponentId,
    renderId: RenderId,
    detail: RenderDetail,
    timestamp: number,
  ): RenderSnapshot {
    const rawHooks = inspectHooks(detail.fiber);
    const rawContexts = inspectContexts(detail.fiber);
    const hooks = rawHooks.map((h) => serializeHook(h));
    const contexts: ContextSnapshot[] = rawContexts.map((c) => ({
      value: serializer.serialize(c.value),
      ...(c.displayName ? { displayName: c.displayName } : {}),
    }));

    const snapshot: RenderSnapshot = {
      renderId,
      componentId: id,
      timestamp,
      props: serializer.serialize(detail.fiber.memoizedProps),
      hooks,
      contexts,
      state: combinedState(detail, rawHooks),
      context: combinedContext(rawContexts),
    };
    if (config?.captureDOM) {
      const nodes = fiber.domNodesOf(id);
      const first = nodes[0];
      if (first) {
        const dom = snapshotDom(first);
        if (dom) snapshot.dom = dom;
      }
    }
    return snapshot;
  }

  function serializeHook(h: RawHook): HookSnapshot {
    const snapshot: HookSnapshot = { index: h.index, kind: h.kind };
    if ("value" in h) snapshot.value = serializer.serialize(h.value);
    if (h.deps !== undefined) {
      snapshot.deps = h.deps === null ? null : h.deps.map((d) => serializer.serialize(d));
    }
    return snapshot;
  }

  /** Timed effect runs/cleanups from fiber.create wraps, flushed after passives. */
  function handlePostCommit(obs: {
    effects: Array<{
      componentId: ComponentId;
      hookIndex: number;
      phase: "run" | "cleanup";
      duration: number;
      timestamp: number;
    }>;
  }): void {
    if (!recording || !config) return;
    if (timeTravel.isActive()) return;
    if (obs.effects.length === 0) return;
    const interactionId = activeInteractionId();
    for (const e of obs.effects) {
      const event: EffectEvent = {
        id: nextEventId(),
        type: "effect",
        timestamp: e.timestamp,
        componentId: e.componentId,
        effectId: nextEffectId(),
        phase: e.phase,
        duration: e.duration,
        hookIndex: e.hookIndex,
        ...(interactionId !== null ? { interactionId } : {}),
      };
      pendingEvents.push(event);
    }
    scheduleFlush();
  }

  /** Combine state-bearing hooks (or class state) into one value for diffing. */
  function combinedState(detail: RenderDetail, hooks: RawHook[]): SerializedValue {
    const classState = inspectClassState(detail.fiber);
    if (classState !== undefined) return serializer.serialize(classState);
    const stateValues = hooks.filter((h) => h.kind === "state").map((h) => h.value);
    return serializer.serialize(stateValues);
  }

  function combinedContext(contexts: { value: unknown }[]): SerializedValue {
    return serializer.serialize(contexts.map((c) => c.value));
  }

  function deriveReasons(
    detail: RenderDetail,
    instance: ComponentInstance,
    rendered: Set<ComponentId>,
  ): RenderReason[] {
    const reasons: RenderReason[] = [];
    switch (detail.reason) {
      case "mount":
        reasons.push({ type: "mount" });
        break;
      case "props":
        reasons.push({ type: "props", changed: detail.changedPropKeys });
        break;
      case "state-or-parent":
        if (instance.parentId !== undefined && rendered.has(instance.parentId)) {
          reasons.push({ type: "parent", componentId: instance.parentId });
        } else {
          reasons.push({ type: "state", hookIndex: 0 });
        }
        break;
    }
    // Compiler-aware: a re-render of an uncompiled component with a fresh parent
    // is exactly the case manual memoization used to target — surface it as
    // evidence rather than recommending useMemo (DESIGN §1.4).
    if (!instance.compiler.compiled && detail.reason !== "mount") {
      reasons.push({ type: "compiler-bailout", reason: instance.compiler.bailoutReason ?? "not compiled by React Compiler" });
    }
    return reasons;
  }

  // ── Interaction attribution ────────────────────────────────────────────────

  function attachInteractionListeners(): void {
    if (typeof document === "undefined") return;
    for (const kind of INTERACTION_EVENTS) {
      const handler = (ev: Event) => onUserEvent(kind, ev);
      document.addEventListener(kind, handler, { capture: true, passive: true });
      listenerCleanups.push(() => document.removeEventListener(kind, handler, { capture: true }));
    }
  }

  function onUserEvent(kind: (typeof INTERACTION_EVENTS)[number], ev: Event): void {
    if (!recording || !config) return;
    const id = nextInteractionId();
    currentInteraction = { id, until: now() + config.interactionWindowMs };
    const target = ev.target instanceof Node ? fiber.resolveComponent(ev.target) : null;
    const interaction: InteractionEvent = {
      id: nextEventId(),
      type: "interaction",
      timestamp: now(),
      interactionId: id,
      kind: kind === "keydown" ? "keypress" : kind,
      ...(target ? { target: { selector: describe(ev.target as Node), componentId: target.id } } : {}),
    };
    pendingEvents.push(interaction);
    scheduleFlush();
  }

  function activeInteractionId(): InteractionId | null {
    if (currentInteraction && now() <= currentInteraction.until) return currentInteraction.id;
    currentInteraction = null;
    return null;
  }

  // ── Flushing ────────────────────────────────────────────────────────────────

  function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    const schedule =
      typeof queueMicrotask === "function" ? queueMicrotask : (fn: () => void) => setTimeout(fn, 0);
    schedule(flush);
  }

  function flush(): void {
    flushScheduled = false;
    if (!config) return;
    if (
      pendingEvents.length === 0 &&
      pendingSnapshots.length === 0 &&
      pendingCommitSnapshots.length === 0
    )
      return;

    const frame: EventsBatchMessage["payload"] = {
      events: pendingEvents,
      snapshots: pendingSnapshots,
      instances: [...pendingInstances.values()],
      ...(pendingCommitSnapshots.length > 0 ? { commitSnapshots: pendingCommitSnapshots } : {}),
    };
    eventsInWindow += pendingEvents.length;
    bytesInWindow += approxBytes(frame);

    pendingEvents = [];
    pendingSnapshots = [];
    pendingInstances = new Map();
    pendingCommitSnapshots = [];

    config.onFrame(frame);
    maybeReportOverhead();
  }

  function maybeReportOverhead(): void {
    if (!config?.onOverhead) return;
    const elapsed = now() - windowStart;
    if (elapsed < 1000) return;
    config.onOverhead({
      cpuPercent: (cpuTimeMs / elapsed) * 100,
      bytesApprox: bytesInWindow,
      eventsPerSec: (eventsInWindow / elapsed) * 1000,
    });
    cpuTimeMs = 0;
    eventsInWindow = 0;
    bytesInWindow = 0;
    windowStart = now();
  }

  return { start, stop, isRecording, snapshot, timeTravel };
}

function approxBytes(frame: EventsBatchMessage["payload"]): number {
  // Cheap size estimate without full serialization on the hot path.
  return frame.events.length * 200 + frame.snapshots.length * 400;
}

function describe(node: Node): string {
  if (node.nodeType !== Node.ELEMENT_NODE) return node.nodeName.toLowerCase();
  const el = node as Element;
  const id = el.id ? `#${el.id}` : "";
  const cls = typeof el.className === "string" && el.className ? `.${el.className.split(/\s+/)[0]}` : "";
  return `${el.nodeName.toLowerCase()}${id}${cls}`;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
