/**
 * Main-thread TraceClient: the trace worker is the authoritative database.
 * React holds UI state + a sync mirror of the worker store for point reads
 * during the remaining UI migration (inspector tabs, time travel apply sets).
 *
 * Hot-path ingest: worker-only when available (`postMessage({ type: "frame" })`).
 * The local TraceStore is updated from `{ type: "ingested" }` — never dual-written
 * on the ingest call itself. Doctor / other tees use {@link TraceClient.onFrame}.
 *
 * Worker supervision: `onerror` + ping/pong heartbeat. On death we respawn,
 * `wal.recover()`, rehydrate the local mirror, and ask the panel to resync.
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
import type { TraceQuery, TraceQueryResult } from "./traceQuery.js";

export type { TraceWorkerApi, TraceWorkerStats, TraceSessionExport, TraceSegment };
export type { TraceQuery, TraceQueryResult };

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
  /**
   * Sync mirror of the worker store for point UI reads. Not dual-written on
   * ingest — updated from worker `{ type: "ingested" }` (or local when no worker).
   */
  readonly store: TraceStore;
  /** Worker generation — bumps on every authoritative ingest / flag update. */
  readonly generation: number;
  readonly worker: Worker | null;
  readonly api: Comlink.Remote<TraceWorkerApi> | null;
  /**
   * Worker-authoritative ingest. Pass `meta` when {@link TraceClientOptions.durableWal}
   * is on so the worker can append + signal durability for page acks.
   */
  ingest(batch: EventsBatchMessage["payload"], meta?: TraceIngestMeta): void;
  /**
   * Tee raw frames (Doctor, etc.) without depending on the sync mirror's
   * `onIngest`. Fires once per ingest call.
   */
  onFrame(cb: (batch: EventsBatchMessage["payload"]) => void): () => void;
  clear(): void;
  beginSegment(previousSessionId: string | null, nextSessionId: string): void | Promise<void>;
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
  /** Typed viewport / entity query against the worker (falls back to local). */
  query(q: TraceQuery): Promise<TraceQueryResult>;
  subscribe(selector: TraceSelector, cb: () => void): () => void;
  subscribeRemote(selector: TraceSelector, cb: () => void): Promise<() => void>;
  flushWal(): Promise<void>;
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
 * Ingest is worker-authoritative: the local mirror updates from `{ type: "ingested" }`.
 * Frame tees (Doctor) use {@link TraceClient.onFrame}, not `store.onIngest`.
 */
export function createTraceClient(options: TraceClientOptions = {}): TraceClientHandle {
  const store = new TraceStore();
  const causality = createCausality(store);
  const durableWal = options.durableWal === true;
  const walHandlers = options.wal ?? {};
  const frameObservers = new Set<(batch: EventsBatchMessage["payload"]) => void>();
  let generation = 0;

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
  const pendingQueries = new Map<
    number,
    { resolve: (r: TraceQueryResult) => void; reject: (e: Error) => void }
  >();
  let nextRequestId = 1;
  /** True after the first successful recover cycle (boot or respawn). */
  let recoveredOnce = false;
  /** Main-thread segment archive when the worker is unavailable. */
  const localSegments: TraceSegment[] = [];
  let localActiveId: string | null = null;

  function notifyFrames(batch: EventsBatchMessage["payload"]): void {
    for (const cb of frameObservers) cb(batch);
  }

  function markWastedLocal(batch: EventsBatchMessage["payload"]): void {
    const wasted: RenderId[] = [];
    const expected: RenderId[] = [];
    for (const event of batch.events) {
      if (event.type !== "render") continue;
      try {
        const verdict = causality.why(event.renderId).verdict;
        if (verdict === "no-observable-change") wasted.push(event.renderId);
        else if (verdict === "expected") expected.push(event.renderId);
      } catch {
        /* no verdict */
      }
    }
    store.markWastedMany(wasted, expected);
  }

  function mirrorIngest(batch: EventsBatchMessage["payload"]): void {
    store.ingest(batch);
    markWastedLocal(batch);
  }

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
      case "ingested":
        generation = msg.generation;
        // Sync mirror for UI point reads — Doctor already teed via onFrame.
        mirrorIngest(msg.batch);
        if (msg.wasted) {
          store.markWastedMany(msg.wasted);
        }
        break;
      case "cleared":
        generation = msg.generation;
        store.clear();
        break;
      case "flags":
        generation = msg.generation;
        store.markWastedMany(msg.wasted, msg.expected);
        break;
      case "query-result": {
        const pending = pendingQueries.get(msg.requestId);
        if (pending) {
          pendingQueries.delete(msg.requestId);
          if (msg.error) pending.reject(new Error(msg.error));
          else pending.resolve(msg.result);
        }
        break;
      }
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
          store.clear();
          for (const frame of recovered.frames) mirrorIngest(frame);
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
    get generation() {
      return generation;
    },
    get worker() {
      return worker;
    },
    get api() {
      return api;
    },
    ingest(batch, meta) {
      notifyFrames(batch);
      if (!worker) {
        // No worker: local store is authoritative.
        mirrorIngest(batch);
        generation++;
        if (durableWal && meta) {
          walHandlers.onDurable?.(meta.sessionId, [meta.seq]);
        }
        return;
      }
      // Worker-authoritative — do not dual-write here; mirror on `ingested`.
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
    onFrame(cb) {
      frameObservers.add(cb);
      return () => {
        frameObservers.delete(cb);
      };
    },
    clear() {
      store.clear();
      generation++;
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
        mirrorIngest(session.payload);
        return;
      }
      store.clear();
      mirrorIngest(session.payload);
    },
    async listSegments() {
      if (api) return api.listSegments();
      return [...localSegments];
    },
    async stitchSegments(ids) {
      if (api) {
        const session = await api.stitchSegments(ids);
        store.clear();
        mirrorIngest(session.payload);
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
      mirrorIngest(payload);
      return session;
    },
    async stats() {
      if (api) return api.stats();
      return { ...store.stats(), columnarRenders: store.timelineIndex.count, generation };
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
    async query(q) {
      if (api) return api.query(q);
      // Local fallback for typed queries.
      switch (q.kind) {
        case "timeline-range":
          return { kind: "timeline-range", result: store.queryTimeline(q) };
        case "hit-test":
          return {
            kind: "hit-test",
            result: store.hitTest(q.t, q.laneKey ?? null, {
              rowStart: q.rowStart,
              rowEnd: q.rowEnd,
              includeQuiet: q.includeQuiet,
              laneFilter: q.laneFilter,
            }),
          };
        case "render":
          return { kind: "render", result: store.getRender(q.id) };
        case "component-renders":
          return {
            kind: "component-renders",
            result: store.rendersOf(q.componentId).filter((render) => {
              if (q.t0 !== undefined && render.timestamp < q.t0) return false;
              if (q.t1 !== undefined && render.timestamp > q.t1) return false;
              return true;
            }),
          };
        case "tree-window": {
          const result = store.flatTree.queryWindow({
            expanded: new Set(q.expanded),
            scrollTop: q.scrollTop,
            viewH: q.viewH,
            rowHeight: q.rowHeight ?? 26,
          });
          return { kind: "tree-window", result };
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
        case "apply-set-delta": {
          const { applySetAt } = await import("@reactlens/trace-engine");
          const set = applySetAt(store, q.t);
          return {
            kind: "apply-set-delta",
            result: [...set.entries()].map(([componentId, renderId]) => ({
              componentId,
              renderId,
            })),
          };
        }
      }
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
      frameObservers.clear();
      for (const [, p] of pendingQueries) p.reject(new Error("disposed"));
      pendingQueries.clear();
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
