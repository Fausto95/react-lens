import type {
  LensEvent,
  RenderEvent,
  RenderReason,
  InteractionEvent,
  ComponentId,
  ComponentInstance,
  RenderSnapshot,
  RenderId,
  EventId,
  InteractionId,
  EventsBatchMessage,
} from "@react-lens/protocol";
import { createIdFactory } from "@react-lens/protocol";
import type { HookSnapshot, ContextSnapshot, SerializedValue } from "@react-lens/protocol";
import type { FiberBridge, CommitObservation, RenderDetail, RawHook } from "@react-lens/fiber";
import { inspectHooks, inspectContexts, inspectClassState } from "@react-lens/fiber";
import type { Serializer } from "@react-lens/serializer";
import { snapshotDom } from "./dom-snapshot.js";

export interface CaptureConfig {
  captureDOM: boolean;
  /** Ms after a user event during which renders are attributed to it. */
  interactionWindowMs: number;
  onFrame: (frame: EventsBatchMessage["payload"]) => void;
  /** Optional overhead telemetry sink. */
  onOverhead?: (report: { cpuPercent: number; bytesApprox: number; eventsPerSec: number }) => void;
}

const DEFAULT_CONFIG: Omit<CaptureConfig, "onFrame"> = {
  captureDOM: true,
  interactionWindowMs: 200,
};

export interface Instrumentation {
  start(config: CaptureConfig): void;
  stop(): void;
  isRecording(): boolean;
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

  let recording = false;
  let config: CaptureConfig | null = null;
  let disposeCommit: (() => void) | null = null;
  const listenerCleanups: Array<() => void> = [];

  // Pending frame buffer — batched, never one message per event.
  let pendingEvents: LensEvent[] = [];
  let pendingSnapshots: RenderSnapshot[] = [];
  let pendingInstances = new Map<ComponentId, ComponentInstance>();
  let flushScheduled = false;

  let currentInteraction: { id: InteractionId; until: number } | null = null;

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
    fiber.install();
    attachInteractionListeners();
    windowStart = now();
  }

  function stop(): void {
    if (!recording) return;
    recording = false;
    disposeCommit?.();
    disposeCommit = null;
    for (const cleanup of listenerCleanups) cleanup();
    listenerCleanups.length = 0;
    flush();
  }

  function isRecording(): boolean {
    return recording;
  }

  function handleCommit(commit: CommitObservation): void {
    if (!recording || !config) return;
    const t0 = now();
    const renderedSet = new Set(commit.rendered);
    const interactionId = activeInteractionId();

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
      pendingSnapshots.push(buildSnapshot(id, renderId, detail, commit.timestamp));
    }

    cpuTimeMs += now() - t0;
    scheduleFlush();
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
    if (pendingEvents.length === 0 && pendingSnapshots.length === 0) return;

    const frame: EventsBatchMessage["payload"] = {
      events: pendingEvents,
      snapshots: pendingSnapshots,
      instances: [...pendingInstances.values()],
    };
    eventsInWindow += pendingEvents.length;
    bytesInWindow += approxBytes(frame);

    pendingEvents = [];
    pendingSnapshots = [];
    pendingInstances = new Map();

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

  return { start, stop, isRecording };
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
