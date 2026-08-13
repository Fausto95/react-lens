/**
 * Main-thread TraceClient: spawns the trace worker, dual-writes into a local
 * TraceStore cache for sync UI reads, and exposes Comlink query helpers.
 *
 * Hot-path ingest uses raw `postMessage({ type: "frame" })`; optional
 * `sessionId`/`seq` make the worker own the durable WAL append. Comlink
 * `ingest` remains available for callers that prefer the RPC surface.
 *
 * Worker supervision: `onerror` + ping/pong heartbeat. On death we respawn,
 * `wal.recover()`, rehydrate the local cache, and ask the panel to resync the
 * page — target recovery under 1s (WAL IDB + worker boot, no full page wait).
 */
import * as Comlink from "comlink";
import { TraceStore, type CommitSummary, type TraceSelector } from "@reactlens/trace-engine";
import { createCausality, type Cause, type Causality, type WhyResult } from "@reactlens/causality";
import type {
  ComponentId,
  ComponentInstance,
  EventsBatchMessage,
  RenderEvent,
  RenderId,
  RenderSnapshot,
} from "@reactlens/protocol";
import type {
  TraceOutMessage,
  TraceSegment,
  TraceSessionExport,
  TraceWorkerApi,
  TraceWorkerStats,
} from "./traceWorker.js";
import type { RecoveredSession } from "./wal.js";

export type { TraceWorkerApi, TraceWorkerStats, TraceSessionExport, TraceSegment };

/** Ping interval while the worker is alive. */
const WORKER_HEARTBEAT_MS = 2_000;
/** Missed pong → treat as dead and respawn. */
const WORKER_HEARTBEAT_TIMEOUT_MS = 5_000;

export interface TraceClientWalHandlers {
  /** These seqs of `sessionId` are on disk (or memory-fallback durable). */
  onDurable?: (sessionId: string, seqs: readonly number[]) => void;
  /** Write never landed; panel must not ack — page will re-deliver. */
  onFailed?: (sessionId: string, seqs: readonly number[]) => void;
  /** Budget forced oldest frames out of the recovery log. */
  onDropped?: (count: number) => void;
  /**
   * Called after boot (and after respawn) with whatever the WAL still holds.
   * Frames are already ingested into the local cache + worker store.
   */
  onRecovered?: (recovered: RecoveredSession | null) => void;
  /**
   * Worker was respawned after a crash/timeout. Panel should `resyncRequest`
   * so the page replays anything not yet durable.
   */
  onResync?: () => void;
}

export interface TraceClientOptions {
  /**
   * When true, `ingest(batch, { sessionId, seq })` asks the worker to WAL-append
   * and surface durability via {@link TraceClientWalHandlers}. Extension panel
   * sets this; embed/playground leaves it off.
   */
  durableWal?: boolean;
  wal?: TraceClientWalHandlers;
}

export interface TraceIngestMeta {
  sessionId: string;
  seq: number;
}

export interface TraceClient {
  readonly workerAvailable: boolean;
  /** Local cache — sync reads for the panel during migration. */
  readonly store: TraceStore;
  /**
   * Underlying worker (when spawned). Prefer {@link ingest} which dual-writes;
   * use this for raw hot-path posts or diagnostics.
   */
  readonly worker: Worker | null;
  /** Comlink RPC surface; null when the worker failed to spawn. */
  readonly api: Comlink.Remote<TraceWorkerApi> | null;
  /**
   * Dual-write ingest. Pass `meta` when {@link TraceClientOptions.durableWal}
   * is on so the worker can append + signal durability for page acks.
   */
  ingest(batch: EventsBatchMessage["payload"], meta?: TraceIngestMeta): void;
  clear(): void;
  /**
   * Archive the current document then clear — used on navigation so prior
   * segments stay stitchable in the worker.
   */
  beginSegment(previousSessionId: string | null, nextSessionId: string): void | Promise<void>;
  /** Async queries (worker when available, else local cache). */
  export(): Promise<EventsBatchMessage["payload"]>;
  exportSession(meta?: TraceSessionExport["meta"]): Promise<TraceSessionExport>;
  importSession(session: TraceSessionExport): Promise<void>;
  listSegments(): Promise<TraceSegment[]>;
  stitchSegments(ids?: string[]): Promise<TraceSessionExport>;
  stats(): Promise<TraceWorkerStats>;
  instance(id: ComponentId): Promise<ComponentInstance | undefined>;
  snapshot(renderId: RenderId): Promise<RenderSnapshot | undefined>;
  getRender(renderId: RenderId): Promise<RenderEvent | undefined>;
  commits(): Promise<CommitSummary[]>;
  getCauses(renderId: RenderId): Promise<Cause[]>;
  why(renderId: RenderId): Promise<WhyResult>;
  rootCause(renderId: RenderId): Promise<Cause | undefined>;
  /**
   * Prefer the local cache subscribe for UI (sync). Worker subscribe is for
   * cross-thread listeners via Comlink.proxy.
   */
  subscribe(selector: TraceSelector, cb: () => void): () => void;
  /** Worker-side subscribe when a worker is available; else local. */
  subscribeRemote(selector: TraceSelector, cb: () => void): Promise<() => void>;
  /** Flush the worker WAL (panel teardown). */
  flushWal(): Promise<void>;
  /** Await initial (or post-respawn) WAL recovery. */
  whenReady(): Promise<void>;
  dispose(): void;
}

export interface TraceClientHandle {
  store: TraceStore;
  causality: Causality;
  client: TraceClient;
  dispose: () => void;
}

/**
 * Spawns the trace worker and returns a handle the panel can use. Falls back to
 * a main-thread-only TraceStore when the worker cannot be created (same
 * graceful degradation as {@link createDoctorClient}).
 *
 * Ingest dual-writes: the local cache updates synchronously for UI reads, and
 * the worker gets a raw `{ type: "frame" }` post (authoritative store + WAL).
 * Worker `{ type: "ingested" }` acks are intentionally not re-applied here —
 * that would double-fire `onIngest` observers (Doctor tee).
 */
export function createTraceClient(options: TraceClientOptions = {}): TraceClientHandle {
  const store = new TraceStore();
  const causality = createCausality(store);
  const durableWal = options.durableWal === true;
  const walHandlers = options.wal ?? {};

  let worker: Worker | null = null;
  let api: Comlink.Remote<TraceWorkerApi> | null = null;
  let disposed = false;
  let pingId = 0;
  let lastPongAt = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let readyResolve: (() => void) | null = null;
  let readyPromise = new Promise<void>((r) => {
    readyResolve = r;
  });
  const pendingFlush = new Map<number, () => void>();
  let nextRequestId = 1;
  /** True after the first successful recover cycle (boot or respawn). */
  let recoveredOnce = false;
  /** Main-thread segment archive when the worker is unavailable. */
  const localSegments: TraceSegment[] = [];
  let localActiveId: string | null = null;

  function markReady(): void {
    readyResolve?.();
    readyResolve = null;
  }

  function resetReady(): void {
    readyPromise = new Promise<void>((r) => {
      readyResolve = r;
    });
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function startHeartbeat(w: Worker): void {
    stopHeartbeat();
    lastPongAt = Date.now();
    heartbeatTimer = setInterval(() => {
      if (disposed || worker !== w) return;
      if (Date.now() - lastPongAt > WORKER_HEARTBEAT_TIMEOUT_MS) {
        // Wedged worker: respawn + WAL recover + panel resync (<1s target).
        void respawn("heartbeat-timeout");
        return;
      }
      try {
        w.postMessage({ type: "ping", id: ++pingId });
      } catch {
        void respawn("ping-failed");
      }
    }, WORKER_HEARTBEAT_MS);
  }

  function onWorkerMessage(e: MessageEvent<TraceOutMessage>): void {
    const msg = e.data;
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;
    switch (msg.type) {
      case "pong":
        lastPongAt = Date.now();
        break;
      case "wal-durable":
        walHandlers.onDurable?.(msg.sessionId, msg.seqs);
        break;
      case "wal-failed":
        walHandlers.onFailed?.(msg.sessionId, msg.seqs);
        break;
      case "wal-dropped":
        walHandlers.onDropped?.(msg.count);
        break;
      case "wal-recovered": {
        const recovered = msg.recovered;
        if (recovered) {
          // Local cache may already hold live frames; clear+replay keeps it
          // aligned with the worker after a cold boot / respawn.
          store.clear();
          for (const frame of recovered.frames) store.ingest(frame);
        }
        walHandlers.onRecovered?.(recovered);
        recoveredOnce = true;
        markReady();
        break;
      }
      case "wal-flushed": {
        const done = pendingFlush.get(msg.requestId);
        if (done) {
          pendingFlush.delete(msg.requestId);
          done();
        }
        break;
      }
      // ingested / cleared: dual-write already updated the local cache.
      default:
        break;
    }
  }

  function attachWorker(w: Worker): void {
    w.addEventListener("message", onWorkerMessage as EventListener);
    w.onerror = () => {
      void respawn("onerror");
    };
    // Comlink also listens on `message`; wrapping after construction is fine —
    // both handlers see the same events.
    api = Comlink.wrap<TraceWorkerApi>(w);
    worker = w;
    startHeartbeat(w);
  }

  function spawnWorker(): Worker | null {
    try {
      return new Worker(new URL("./traceWorker.ts", import.meta.url), { type: "module" });
    } catch {
      return null;
    }
  }

  function requestRecover(w: Worker): void {
    try {
      w.postMessage({ type: "wal-recover", requestId: nextRequestId++ });
    } catch {
      markReady();
    }
  }

  /**
   * Tear down the dead worker, boot a fresh one, recover WAL into both stores,
   * and notify the panel to resync the page cursor. Comment target: <1s.
   */
  async function respawn(_reason: string): Promise<void> {
    if (disposed) return;
    stopHeartbeat();
    if (api) {
      try {
        api[Comlink.releaseProxy]();
      } catch {
        /* already dead */
      }
      api = null;
    }
    try {
      worker?.terminate();
    } catch {
      /* ignore */
    }
    worker = null;

    const w = spawnWorker();
    if (!w) {
      markReady();
      return;
    }
    resetReady();
    attachWorker(w);
    requestRecover(w);
    await readyPromise;
    // After the first boot recovery, a respawn means we may have missed frames
    // that never reached WAL — ask the page to replay from the panel cursor.
    if (recoveredOnce) walHandlers.onResync?.();
  }

  // Boot.
  {
    const w = spawnWorker();
    if (w) {
      attachWorker(w);
      if (durableWal) {
        requestRecover(w);
      } else {
        recoveredOnce = true;
        markReady();
      }
    } else {
      recoveredOnce = true;
      markReady();
    }
  }

  const client: TraceClient = {
    get workerAvailable() {
      return worker !== null && api !== null;
    },
    store,
    get worker() {
      return worker;
    },
    get api() {
      return api;
    },
    ingest(batch, meta) {
      // Sync UI path first — panel reads stay synchronous during migration.
      store.ingest(batch);
      if (!worker) {
        // No worker: durability is vacuously true for the panel cursor.
        if (durableWal && meta) {
          walHandlers.onDurable?.(meta.sessionId, [meta.seq]);
        }
        return;
      }
      if (durableWal && meta) {
        worker.postMessage({
          type: "frame",
          batch,
          sessionId: meta.sessionId,
          seq: meta.seq,
        });
      } else {
        worker.postMessage({ type: "frame", batch });
      }
    },
    clear() {
      store.clear();
      worker?.postMessage({ type: "clear" });
    },
    beginSegment(previousSessionId, nextSessionId) {
      if (api) {
        const remote = api.beginSegment(previousSessionId, nextSessionId);
        store.clear();
        return remote;
      }
      const archiveId = previousSessionId ?? localActiveId;
      if (archiveId != null) {
        const payload = store.export();
        if (payload.events.length > 0 || payload.instances.length > 0) {
          localSegments.push({
            sessionId: archiveId,
            archivedAt: new Date().toISOString(),
            payload,
            eventCount: payload.events.length,
          });
          if (localSegments.length > 8) localSegments.shift();
        }
      }
      localActiveId = nextSessionId;
      store.clear();
    },
    async export() {
      if (api) return api.export();
      return store.export();
    },
    async exportSession(meta) {
      if (api) return api.exportSession(meta);
      const { PROTOCOL_VERSION } = await import("@reactlens/protocol");
      return {
        protocolVersion: PROTOCOL_VERSION,
        exportedAt: new Date().toISOString(),
        payload: store.export(),
        ...(meta ? { meta } : {}),
      };
    },
    async importSession(session) {
      if (api) {
        await api.importSession(session);
        store.clear();
        store.ingest(session.payload);
        return;
      }
      store.clear();
      store.ingest(session.payload);
    },
    async listSegments() {
      if (api) return api.listSegments();
      return [...localSegments];
    },
    async stitchSegments(ids) {
      if (api) {
        const session = await api.stitchSegments(ids);
        store.clear();
        store.ingest(session.payload);
        return session;
      }
      const chosen =
        ids && ids.length > 0
          ? localSegments.filter((s) => ids.includes(s.sessionId))
          : [...localSegments];
      const parts = chosen.map((s) => s.payload);
      const live = store.export();
      if ((!ids || ids.length === 0) && (live.events.length > 0 || live.instances.length > 0)) {
        parts.push(live);
      }
      const events = parts.flatMap((p) => p.events);
      const snapshots = parts.flatMap((p) => p.snapshots);
      const byId = new Map(parts.flatMap((p) => p.instances.map((i) => [i.id, i] as const)));
      const payload = { events, snapshots, instances: [...byId.values()] };
      const { PROTOCOL_VERSION } = await import("@reactlens/protocol");
      const session: TraceSessionExport = {
        protocolVersion: PROTOCOL_VERSION,
        exportedAt: new Date().toISOString(),
        payload,
        meta: { title: `Stitched ${chosen.length || parts.length} segment(s)` },
      };
      store.clear();
      store.ingest(payload);
      return session;
    },
    async stats() {
      if (api) return api.stats();
      return store.stats();
    },
    async instance(id) {
      if (api) return api.instance(id);
      return store.instance(id);
    },
    async snapshot(renderId) {
      if (api) return api.snapshot(renderId);
      return store.snapshot(renderId);
    },
    async getRender(renderId) {
      if (api) return api.getRender(renderId);
      return store.getRender(renderId);
    },
    async commits() {
      if (api) return api.commits();
      return store.commits();
    },
    async getCauses(renderId) {
      if (api) return api.getCauses(renderId);
      return causality.why(renderId).causes;
    },
    async why(renderId) {
      if (api) return api.why(renderId);
      return causality.why(renderId);
    },
    async rootCause(renderId) {
      if (api) return api.rootCause(renderId);
      return causality.rootCause(renderId);
    },
    subscribe(selector, cb) {
      return store.subscribe(selector, cb);
    },
    async subscribeRemote(selector, cb) {
      if (api) return api.subscribe(selector, Comlink.proxy(cb));
      return store.subscribe(selector, cb);
    },
    flushWal() {
      const w = worker;
      if (!w || !durableWal) return Promise.resolve();
      const requestId = nextRequestId++;
      return new Promise<void>((resolve) => {
        pendingFlush.set(requestId, resolve);
        try {
          w.postMessage({ type: "wal-flush", requestId });
        } catch {
          pendingFlush.delete(requestId);
          resolve();
        }
        // Don't hang teardown if the worker is already dead.
        setTimeout(() => {
          if (pendingFlush.delete(requestId)) resolve();
        }, 2_000);
      });
    },
    whenReady() {
      return readyPromise;
    },
    dispose() {
      disposed = true;
      stopHeartbeat();
      if (api) {
        try {
          api[Comlink.releaseProxy]();
        } catch {
          /* ignore */
        }
        api = null;
      }
      try {
        worker?.terminate();
      } catch {
        /* ignore */
      }
      worker = null;
      markReady();
    },
  };

  return {
    store,
    causality,
    client,
    dispose: () => client.dispose(),
  };
}

export { TraceProvider } from "./TraceProvider.js";
export {
  bindTraceVersion,
  traceClientAtom,
  traceVersionAtom,
  traceStatsAtom,
  exportSessionAtom,
  causesAtom,
  causesRenderIdAtom,
} from "./atoms/trace.js";
