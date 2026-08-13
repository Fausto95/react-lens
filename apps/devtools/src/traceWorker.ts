/// <reference lib="webworker" />
/**
 * Trace worker: owns the authoritative TraceStore, causality engine, and (when
 * IndexedDB is available) the durable WAL — off the panel main thread.
 *
 * Hot path: raw `postMessage({ type: "frame", batch, sessionId?, seq? })`.
 * Queries: Comlink. WAL durability signals (`wal-durable` / `wal-failed`) go
 * back as raw postMessages so the panel can ack the page only after disk.
 *
 * Supervision: answers `ping` with `pong` so the main-thread client can detect
 * a wedged worker and respawn (<1s recovery target; see traceClient).
 */
import * as Comlink from "comlink";
import { TraceStore, type CommitSummary, type TraceSelector } from "@reactlens/trace-engine";
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
} from "@reactlens/protocol";
import { createTraceWal, type RecoveredSession, type TraceWal } from "./wal.js";
import { createIdbWalStore } from "./walIdb.js";

export type TraceFrameMessage = {
  type: "frame";
  batch: EventsBatchMessage["payload"];
  /** When set with `seq`, the worker appends to the WAL after ingest. */
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
  | TraceWalFlushMessage;

export type TraceIngestedMessage = { type: "ingested"; batch: EventsBatchMessage["payload"] };
export type TraceClearedMessage = { type: "cleared" };
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
export type TraceOutMessage =
  | TraceIngestedMessage
  | TraceClearedMessage
  | TracePongMessage
  | TraceWalDurableMessage
  | TraceWalFailedMessage
  | TraceWalDroppedMessage
  | TraceWalRecoveredMessage
  | TraceWalFlushedMessage;

export interface TraceWorkerStats {
  events: number;
  renders: number;
  snapshots: number;
  components: number;
}

/** Session file shape for download / IDB recents — from @reactlens/protocol. */
export type TraceSessionExport = LensSessionFile;

/** One navigation document archived before the store was cleared for the next. */
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
  /** Session file shape for download / IDB recents (same as session.exportSession). */
  exportSession(meta?: TraceSessionExport["meta"]): TraceSessionExport;
  /** Replace the active store with an imported session. */
  importSession(session: TraceSessionExport): void;
  /**
   * Archive the current document under `previousSessionId` (when set), then
   * clear and mark `nextSessionId` active. Keeps per-sessionId segments.
   */
  beginSegment(previousSessionId: string | null, nextSessionId: string): void;
  listSegments(): TraceSegment[];
  /** Stitch archived segments (and optionally the live store) for offline view. */
  stitchSegments(ids?: string[]): TraceSessionExport;
  stats(): TraceWorkerStats;
  instance(id: ComponentId): ComponentInstance | undefined;
  snapshot(renderId: RenderId): RenderSnapshot | undefined;
  getRender(renderId: RenderId): RenderEvent | undefined;
  commits(): CommitSummary[];
  /** Causality causes for a render (plan: getCauses). */
  getCauses(renderId: RenderId): Cause[];
  why(renderId: RenderId): WhyResult;
  rootCause(renderId: RenderId): Cause | undefined;
  /**
   * Subscribe to a store slice. Pass a Comlink.proxy'd callback from the main
   * thread; returns an unsubscribe function (also proxied).
   */
  subscribe(selector: TraceSelector, cb: () => void): () => void;
}

const store = new TraceStore();
const causality = createCausality(store);

const MAX_SEGMENTS = 8;
const segments: TraceSegment[] = [];
let activeSessionId: string | null = null;

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

function ingestBatch(batch: EventsBatchMessage["payload"]): void {
  store.ingest(batch);
  post({ type: "ingested", batch });
}

/**
 * Ingest then durable-append. When IDB is unavailable, report durable
 * immediately so the panel can still ack (in-memory only — same as pre-WAL).
 */
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

const api: TraceWorkerApi = {
  ingest(batch) {
    ingestBatch(batch);
  },
  clear() {
    store.clear();
    post({ type: "cleared" });
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
    post({ type: "cleared" });
    post({ type: "ingested", batch: loaded.payload });
  },
  beginSegment(previousSessionId, nextSessionId) {
    const archiveId = previousSessionId ?? activeSessionId;
    if (archiveId != null) archiveActive(archiveId);
    else if (store.stats().events > 0) archiveActive(`anon:${Date.now()}`);
    store.clear();
    activeSessionId = nextSessionId;
    post({ type: "cleared" });
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
    const session = toSession(payload, {
      title: `Stitched ${chosen.length || parts.length} segment(s)`,
    });
    post({ type: "cleared" });
    if (payload.events.length > 0) post({ type: "ingested", batch: payload });
    return session;
  },
  stats() {
    return store.stats();
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
};

// Hot path: raw frames bypass Comlink serialization of the call wrapper.
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
