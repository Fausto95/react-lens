/// <reference lib="webworker" />
/**
 * Trace worker: owns the authoritative TraceStore + columnar indexes, and (when
 * IndexedDB is available) the durable WAL — off the panel main thread.
 *
 * Hot path: raw `postMessage({ type: "frame", batch, sessionId?, seq? })`.
 * Queries: Comlink + typed `{ type: "query" }` TraceQuery protocol.
 * Causality flag analysis runs in a child worker so ingest is never blocked.
 *
 * Supervision: answers `ping` with `pong` so the main-thread client can detect
 * a wedged worker and respawn (<1s recovery target; see traceClient).
 */
import * as Comlink from "comlink";
import {
  TraceStore,
  TreeFlags,
  createApplySetCursor,
  diffApplySet,
  type CommitSummary,
  type TraceSelector,
} from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import type { Cause, WhyResult } from "@reactlens/causality";
import {
  exportSessionPayload,
  loadSession,
  type ComponentId,
  type ComponentInstance,
  type EventsBatchMessage,
  type LensSessionFile,
  type RenderEvent,
  type RenderId,
  type RenderSnapshot,
  type TimeTravelEntry,
} from "@reactlens/protocol";
import { createTraceWal, type RecoveredSession, type TraceWal } from "./wal.js";
import { createIdbWalStore } from "./walIdb.js";
import { createIdbColdStore } from "./coldIdb.js";
import type {
  CausalityResult,
  TraceQuery,
  TraceQueryMessage,
  TraceQueryReplyMessage,
  TraceQueryResult,
} from "./traceQuery.js";

export type TraceFrameMessage = {
  type: "frame";
  batch: EventsBatchMessage["payload"];
  sessionId?: string;
  seq?: number;
};
export type TraceClearMessage = { type: "clear" };
export type TracePingMessage = { type: "ping"; id: number };
export type TraceWalRecoverMessage = { type: "wal-recover"; requestId: number };
export type TraceWalFlushMessage = { type: "wal-flush"; requestId: number };
export type TraceInMessage =
  | TraceFrameMessage
  | TraceClearMessage
  | TracePingMessage
  | TraceWalRecoverMessage
  | TraceWalFlushMessage
  | TraceQueryMessage;

export type TraceIngestedMessage = {
  type: "ingested";
  batch: EventsBatchMessage["payload"];
  generation: number;
  wasted?: readonly RenderId[];
};
export type TraceClearedMessage = { type: "cleared"; generation: number };
export type TracePongMessage = { type: "pong"; id: number };
export type TraceWalDurableMessage = {
  type: "wal-durable";
  sessionId: string;
  seqs: readonly number[];
};
export type TraceWalFailedMessage = {
  type: "wal-failed";
  sessionId: string;
  seqs: readonly number[];
};
export type TraceWalDroppedMessage = { type: "wal-dropped"; count: number };
export type TraceWalRecoveredMessage = {
  type: "wal-recovered";
  requestId: number;
  recovered: RecoveredSession | null;
};
export type TraceWalFlushedMessage = { type: "wal-flushed"; requestId: number };
export type TraceFlagsMessage = {
  type: "flags";
  wasted: readonly RenderId[];
  expected: readonly RenderId[];
  generation: number;
};
export type TraceOutMessage =
  | TraceIngestedMessage
  | TraceClearedMessage
  | TracePongMessage
  | TraceWalDurableMessage
  | TraceWalFailedMessage
  | TraceWalDroppedMessage
  | TraceWalRecoveredMessage
  | TraceWalFlushedMessage
  | TraceFlagsMessage
  | TraceQueryReplyMessage;

export interface TraceWorkerStats {
  events: number;
  renders: number;
  snapshots: number;
  components: number;
  columnarRenders?: number;
  generation?: number;
}

export type TraceSessionExport = LensSessionFile;

export interface TraceSegment {
  sessionId: string;
  archivedAt: string;
  payload: EventsBatchMessage["payload"];
  eventCount: number;
}

export interface TraceWorkerApi {
  ingest(batch: EventsBatchMessage["payload"]): void;
  clear(): void;
  export(): EventsBatchMessage["payload"];
  exportSession(meta?: TraceSessionExport["meta"]): TraceSessionExport;
  importSession(session: TraceSessionExport): void;
  beginSegment(previousSessionId: string | null, nextSessionId: string): void;
  listSegments(): TraceSegment[];
  stitchSegments(ids?: string[]): TraceSessionExport;
  stats(): TraceWorkerStats;
  instance(id: ComponentId): ComponentInstance | undefined;
  snapshot(renderId: RenderId): RenderSnapshot | undefined;
  getRender(renderId: RenderId): RenderEvent | undefined;
  commits(): CommitSummary[];
  getCauses(renderId: RenderId): Cause[];
  why(renderId: RenderId): WhyResult;
  rootCause(renderId: RenderId): Cause | undefined;
  subscribe(selector: TraceSelector, cb: () => void): () => void;
  query(q: TraceQuery): TraceQueryResult;
  applySetDelta(t: number): TimeTravelEntry[];
  timeBounds(): { t0: number; t1: number };
}

const store = new TraceStore();
void createIdbColdStore().then((cold) => {
  if (cold) store.retentionManager.setColdStore(cold);
});
const causality = createCausality(store);
const applyCursor = createApplySetCursor(store);
let generation = 0;

const MAX_SEGMENTS = 8;
const segments: TraceSegment[] = [];
let activeSessionId: string | null = null;

let causalityWorker: Worker | null = null;
try {
  causalityWorker = new Worker(new URL("./causalityWorker.ts", import.meta.url), {
    type: "module",
  });
  causalityWorker.onmessage = (e: MessageEvent<CausalityResult>) => {
    const msg = e.data;
    if (!msg || msg.type !== "flags") return;
    for (const id of msg.wasted) store.markWasted(id, true);
    for (const id of msg.expected) store.markWasted(id, false);
    generation++;
    post({
      type: "flags",
      wasted: msg.wasted,
      expected: msg.expected,
      generation,
    });
  };
} catch {
  causalityWorker = null;
}

function archiveActive(sessionId: string): void {
  const payload = store.export();
  if (payload.events.length === 0 && payload.instances.length === 0) return;
  const idx = segments.findIndex((s) => s.sessionId === sessionId);
  const entry: TraceSegment = {
    sessionId,
    archivedAt: new Date().toISOString(),
    payload,
    eventCount: payload.events.length,
  };
  if (idx >= 0) segments[idx] = entry;
  else segments.push(entry);
  while (segments.length > MAX_SEGMENTS) segments.shift();
}

function mergePayloads(parts: EventsBatchMessage["payload"][]): EventsBatchMessage["payload"] {
  const events = parts.flatMap((p) => p.events);
  const snapshots = parts.flatMap((p) => p.snapshots);
  const byId = new Map<ComponentId, ComponentInstance>();
  for (const p of parts) {
    for (const inst of p.instances) byId.set(inst.id, inst);
  }
  return { events, snapshots, instances: [...byId.values()] };
}

function toSession(
  payload: EventsBatchMessage["payload"],
  meta?: TraceSessionExport["meta"],
): TraceSessionExport {
  return exportSessionPayload(payload, meta);
}

function post(msg: TraceOutMessage): void {
  (self as DedicatedWorkerGlobalScope).postMessage(msg);
}

let wal: TraceWal | null = null;
let walReady: Promise<void> = initWal();

async function initWal(): Promise<void> {
  const walStore = await createIdbWalStore();
  if (!walStore) {
    wal = null;
    return;
  }
  wal = createTraceWal(walStore, {
    onDurable: (sessionId, seqs) => {
      post({ type: "wal-durable", sessionId, seqs });
    },
    onFailed: (sessionId, seqs) => {
      post({ type: "wal-failed", sessionId, seqs });
    },
    onDropped: (count) => {
      post({ type: "wal-dropped", count });
    },
  });
}

function analyzeRendersAsync(batch: EventsBatchMessage["payload"]): void {
  const renderIds: RenderId[] = [];
  for (const e of batch.events) {
    if (e.type === "render") renderIds.push(e.renderId);
  }
  if (renderIds.length === 0) return;

  if (causalityWorker) {
    causalityWorker.postMessage({ type: "frame", batch });
    causalityWorker.postMessage({ type: "analyze-renders", renderIds });
    return;
  }

  // Fallback: analyze on this worker after ingest (still O(new), not O(session)).
  for (const id of renderIds) {
    try {
      const verdict = causality.why(id).verdict;
      if (verdict === "no-observable-change") store.markWasted(id, true);
      else if (verdict === "expected") store.markWasted(id, false);
    } catch {
      /* no verdict */
    }
  }
}

function ingestBatch(batch: EventsBatchMessage["payload"]): void {
  store.ingest(batch);
  applyCursor.reset();
  generation++;
  // Ingest must not wait on causality — fire-and-forget.
  analyzeRendersAsync(batch);
  post({ type: "ingested", batch, generation });
}

function ingestDurable(
  batch: EventsBatchMessage["payload"],
  sessionId: string | undefined,
  seq: number | undefined,
): void {
  ingestBatch(batch);
  if (sessionId === undefined || seq === undefined) return;
  void walReady.then(() => {
    if (wal) {
      wal.append(sessionId, seq, batch);
    } else {
      post({ type: "wal-durable", sessionId, seqs: [seq] });
    }
  });
}

function runQuery(q: TraceQuery): TraceQueryResult {
  switch (q.kind) {
    case "timeline-range":
      return { kind: "timeline-range", result: store.queryTimeline(q) };
    case "hit-test":
      return { kind: "hit-test", result: store.hitTest(q.t, q.laneKey ?? null) };
    case "render":
      return { kind: "render", result: store.getRender(q.id) };
    case "component-renders": {
      let renders = store.rendersOf(q.componentId);
      if (q.t0 !== undefined || q.t1 !== undefined) {
        const lo = q.t0 ?? Number.NEGATIVE_INFINITY;
        const hi = q.t1 ?? Number.POSITIVE_INFINITY;
        renders = renders.filter((r) => r.timestamp >= lo && r.timestamp <= hi);
      }
      return { kind: "component-renders", result: renders };
    }
    case "tree-window": {
      const expanded = new Set(q.expanded);
      const projection = q.projection ?? "all";
      const result = store.flatTree.queryWindow({
        expanded,
        scrollTop: q.scrollTop,
        viewH: q.viewH,
        rowHeight: q.rowHeight ?? 26,
        include:
          projection === "all"
            ? undefined
            : (index) => {
                const f = store.flatTree.flags[index]!;
                if (projection === "changed") return (f & TreeFlags.ChangedLast) !== 0;
                if (projection === "waste") return (f & TreeFlags.WastedLast) !== 0;
                return true;
              },
      });
      return { kind: "tree-window", result };
    }
    case "apply-set-delta": {
      const next = applyCursor.moveTo(q.t);
      // Full set as delta from empty when prevT omitted — caller diffs locally.
      const entries: TimeTravelEntry[] = [];
      for (const [componentId, renderId] of next) {
        entries.push({ componentId, renderId });
      }
      return { kind: "apply-set-delta", result: entries };
    }
    case "time-bounds":
      return { kind: "time-bounds", result: store.timeBounds() };
    case "stats-range":
      return {
        kind: "stats-range",
        result: store.statsInRange(q.t0, q.t1, { excludeWasted: q.excludeWasted }),
      };
    case "why":
      return { kind: "why", result: causality.why(q.id) };
    case "instance":
      return { kind: "instance", result: store.instance(q.id) };
    case "snapshot":
      return { kind: "snapshot", result: store.snapshot(q.id) };
    case "commits":
      return { kind: "commits", result: store.commits() };
  }
}

const api: TraceWorkerApi = {
  ingest(batch) {
    ingestBatch(batch);
  },
  clear() {
    store.clear();
    applyCursor.reset();
    generation++;
    causalityWorker?.postMessage({ type: "clear" });
    post({ type: "cleared", generation });
  },
  export() {
    return store.export();
  },
  exportSession(meta) {
    return toSession(store.export(), meta);
  },
  importSession(session) {
    const loaded = loadSession(JSON.stringify(session)) as LensSessionFile;
    store.clear();
    store.ingest(loaded.payload);
    applyCursor.reset();
    generation++;
    post({ type: "cleared", generation });
    post({ type: "ingested", batch: loaded.payload, generation });
  },
  beginSegment(previousSessionId, nextSessionId) {
    const archiveId = previousSessionId ?? activeSessionId;
    if (archiveId != null) archiveActive(archiveId);
    else if (store.stats().events > 0) archiveActive(`anon:${Date.now()}`);
    store.clear();
    applyCursor.reset();
    activeSessionId = nextSessionId;
    generation++;
    causalityWorker?.postMessage({ type: "clear" });
    post({ type: "cleared", generation });
  },
  listSegments() {
    return segments.map((s) => ({ ...s }));
  },
  stitchSegments(ids) {
    const chosen =
      ids && ids.length > 0 ? segments.filter((s) => ids.includes(s.sessionId)) : [...segments];
    const parts = chosen.map((s) => s.payload);
    if (!ids || ids.length === 0) {
      const live = store.export();
      if (live.events.length > 0 || live.instances.length > 0) parts.push(live);
    }
    const payload =
      parts.length > 0 ? mergePayloads(parts) : { events: [], snapshots: [], instances: [] };
    store.clear();
    if (payload.events.length > 0 || payload.instances.length > 0) {
      store.ingest(payload);
    }
    applyCursor.reset();
    generation++;
    const session = toSession(payload, {
      title: `Stitched ${chosen.length || parts.length} segment(s)`,
    });
    post({ type: "cleared", generation });
    if (payload.events.length > 0) post({ type: "ingested", batch: payload, generation });
    return session;
  },
  stats() {
    return {
      ...store.stats(),
      columnarRenders: store.timelineIndex.count,
      generation,
    };
  },
  instance(id) {
    return store.instance(id);
  },
  snapshot(renderId) {
    return store.snapshot(renderId);
  },
  getRender(renderId) {
    return store.getRender(renderId);
  },
  commits() {
    return store.commits();
  },
  getCauses(renderId) {
    return causality.why(renderId).causes;
  },
  why(renderId) {
    return causality.why(renderId);
  },
  rootCause(renderId) {
    return causality.rootCause(renderId);
  },
  subscribe(selector, cb) {
    return store.subscribe(selector, cb);
  },
  query(q) {
    return runQuery(q);
  },
  applySetDelta(t) {
    const prev = new Map(applyCursor.moveTo(t));
    // Re-read as delta from previous internal state is already applied by cursor;
    // return full current set entries for the panel to diff.
    return diffApplySet(new Map(), prev);
  },
  timeBounds() {
    return store.timeBounds();
  },
};

self.addEventListener("message", (e: MessageEvent<TraceInMessage>) => {
  const msg = e.data;
  if (!msg || typeof msg !== "object" || !("type" in msg)) return;
  if (msg.type === "frame") {
    try {
      ingestDurable(msg.batch, msg.sessionId, msg.seq);
    } catch {
      if (msg.sessionId !== undefined && msg.seq !== undefined) {
        post({ type: "wal-failed", sessionId: msg.sessionId, seqs: [msg.seq] });
      }
    }
  } else if (msg.type === "clear") {
    api.clear();
  } else if (msg.type === "ping") {
    post({ type: "pong", id: msg.id });
  } else if (msg.type === "query") {
    try {
      const result = runQuery(msg.query);
      const reply: TraceQueryReplyMessage = {
        type: "query-result",
        requestId: msg.requestId,
        result,
      };
      post(reply);
    } catch (err) {
      post({
        type: "query-result",
        requestId: msg.requestId,
        result: { kind: "time-bounds", result: { t0: 0, t1: 120 } },
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (msg.type === "wal-recover") {
    void walReady
      .then(async () => {
        const recovered = wal ? await wal.recover() : null;
        if (recovered) {
          for (const frame of recovered.frames) ingestBatch(frame);
        }
        post({ type: "wal-recovered", requestId: msg.requestId, recovered });
      })
      .catch(() => {
        post({ type: "wal-recovered", requestId: msg.requestId, recovered: null });
      });
  } else if (msg.type === "wal-flush") {
    void walReady
      .then(async () => {
        if (wal) await wal.flush();
        post({ type: "wal-flushed", requestId: msg.requestId });
      })
      .catch(() => {
        post({ type: "wal-flushed", requestId: msg.requestId });
      });
  }
});

Comlink.expose(api);
