import type {
  LensEvent,
  RenderEvent,
  ComponentId,
  ComponentInstance,
  InteractionId,
  RenderId,
  CommitId,
  CommitSnapshot,
  RenderSnapshot,
  EventsBatchMessage,
} from "@reactlens/protocol";
import { RingBuffer } from "./ring-buffer.js";
import { buildInteractions, type Interaction } from "./interactions.js";

/** A single commit pass: which components rendered, when. */
export interface CommitSummary {
  commitId: CommitId;
  timestamp: number;
  /** Latest render timestamp in the commit (≥ timestamp). */
  endTimestamp: number;
  componentIds: ComponentId[];
  interactionId?: InteractionId;
  totalSelfTime: number;
}

export interface TraceStoreConfig {
  maxEvents: number;
  maxRendersPerComponent: number;
  maxSnapshots: number;
  maxCommits: number;
  /** Whole-page DOM snapshots retained for offline replay. */
  maxCommitSnapshots: number;
}

const DEFAULTS: TraceStoreConfig = {
  maxEvents: 10_000,
  maxRendersPerComponent: 100,
  maxSnapshots: 5_000,
  maxCommits: 1_000,
  maxCommitSnapshots: 300,
};

interface MutableCommit {
  commitId: CommitId;
  timestamp: number;
  endTimestamp: number;
  components: Set<ComponentId>;
  interactionId?: InteractionId;
  totalSelfTime: number;
}

export type TraceSelector =
  | { kind: "component"; id: ComponentId }
  | { kind: "interaction"; id: InteractionId }
  | { kind: "global" };

export type Dispose = () => void;

interface Subscription {
  selector: TraceSelector;
  callback: () => void;
}

/**
 * The single source of truth on the panel side: a normalized, capped event log
 * plus per-component render history and snapshots. Framework-free and
 * unit-testable. The panel subscribes to narrow slices; high-frequency
 * ingestion never touches React state.
 */
export class TraceStore {
  private readonly config: TraceStoreConfig;
  private readonly events: RingBuffer<LensEvent>;
  private readonly rendersByComponent = new Map<ComponentId, RingBuffer<RenderEvent>>();
  private readonly rendersById = new Map<RenderId, RenderEvent>();
  private readonly snapshots = new Map<RenderId, RenderSnapshot>();
  private readonly snapshotOrder: RingBuffer<RenderId>;
  private readonly instances = new Map<ComponentId, ComponentInstance>();
  /** Uncapped lifetime render count per component (rendersOf is capped). */
  private readonly renderTotals = new Map<ComponentId, number>();
  private readonly selfTimeTotals = new Map<ComponentId, number>();
  private readonly eventsByInteractionId = new Map<InteractionId, LensEvent[]>();
  private readonly commitsById = new Map<CommitId, MutableCommit>();
  private readonly commitOrder: RingBuffer<CommitId>;
  /** Throttled whole-page DOM per commit (offline replay), oldest→newest. */
  private readonly commitSnapshots: RingBuffer<CommitSnapshot>;
  /** Set when the event ring overwrites a render — commits rebuild on next read/ingest end. */
  private commitsDirty = false;
  /** Materialized commits(), invalidated whenever any commit mutates. */
  private commitsCache: CommitSummary[] | null = null;
  private readonly subscriptions = new Set<Subscription>();
  private readonly ingestObservers = new Set<(batch: EventsBatchMessage["payload"]) => void>();

  constructor(config?: Partial<TraceStoreConfig>) {
    this.config = { ...DEFAULTS, ...config };
    this.events = new RingBuffer<LensEvent>(this.config.maxEvents);
    this.snapshotOrder = new RingBuffer<RenderId>(this.config.maxSnapshots);
    this.commitOrder = new RingBuffer<CommitId>(this.config.maxCommits);
    this.commitSnapshots = new RingBuffer<CommitSnapshot>(this.config.maxCommitSnapshots);
  }

  ingest(batch: EventsBatchMessage["payload"]): void {
    for (const instance of batch.instances) {
      this.instances.set(instance.id, instance);
    }
    const touched = new Set<ComponentId>();
    const touchedInteractions = new Set<InteractionId>();
    for (const snapshot of batch.snapshots) {
      this.addSnapshot(snapshot);
      // On-demand snapshots arrive in their own batch with no events; mark the
      // component touched so subscribers (the Inspector) re-render and read it.
      touched.add(snapshot.componentId);
    }
    for (const cs of batch.commitSnapshots ?? []) {
      this.commitSnapshots.push(cs);
    }
    for (const event of batch.events) {
      this.addEvent(event);
      if (event.componentId !== undefined) touched.add(event.componentId);
      if (event.interactionId !== undefined) touchedInteractions.add(event.interactionId);
    }
    if (this.commitsDirty) this.rebuildCommitsFromEvents();
    this.notify(touched, touchedInteractions);
    for (const observer of this.ingestObservers) observer(batch);
  }

  /**
   * Observe every ingested batch — used to tee frames into the Doctor worker's
   * mirror store. Distinct from `subscribe`, which only signals that a slice
   * changed; this carries the raw batch.
   */
  onIngest(cb: (batch: EventsBatchMessage["payload"]) => void): Dispose {
    this.ingestObservers.add(cb);
    return () => {
      this.ingestObservers.delete(cb);
    };
  }

  /**
   * One-shot snapshot of everything captured so far, shaped as an ingestable
   * batch. Lets a late-attaching consumer (the Doctor worker) backfill history
   * that was ingested before it subscribed.
   */
  export(): EventsBatchMessage["payload"] {
    return {
      events: this.events.toArray(),
      snapshots: [...this.snapshots.values()],
      instances: [...this.instances.values()],
      commitSnapshots: this.commitSnapshots.toArray(),
    };
  }

  private addEvent(event: LensEvent): void {
    // Idempotent on renderId: the content-script buffer can replay (e.g. after a
    // panel reconnect), and re-ingesting the same render must not double-count.
    if (event.type === "render" && this.rendersById.has(event.renderId)) return;
    const evicted = this.events.push(event);
    if (evicted) this.forgetEvent(evicted);
    if (event.type === "render") {
      const buf = this.rendersByComponent.get(event.componentId) ??
        this.createRenderBuffer(event.componentId);
      buf.push(event);
      this.rendersById.set(event.renderId, event);
      this.renderTotals.set(event.componentId, (this.renderTotals.get(event.componentId) ?? 0) + 1);
      this.selfTimeTotals.set(
        event.componentId,
        (this.selfTimeTotals.get(event.componentId) ?? 0) + event.selfDuration,
      );
      this.recordCommit(event);
    }
    if (event.interactionId !== undefined) {
      const list = this.eventsByInteractionId.get(event.interactionId) ?? [];
      list.push(event);
      this.eventsByInteractionId.set(event.interactionId, list);
    }
  }

  /**
   * Drop indexes that pointed at an event the ring just overwrote. Commits and
   * interactions both derive from the live event log — without this, commit
   * summaries outlive their renders and show up in the timeline idle gutter.
   */
  private forgetEvent(event: LensEvent): void {
    if (event.interactionId !== undefined) {
      const list = this.eventsByInteractionId.get(event.interactionId);
      if (list) {
        const next = list.filter((e) => e.id !== event.id);
        if (next.length === 0) this.eventsByInteractionId.delete(event.interactionId);
        else this.eventsByInteractionId.set(event.interactionId, next);
      }
    }
    if (event.type !== "render") return;
    // Only clear if this renderId still maps to the evicted event (not a newer ingest).
    if (this.rendersById.get(event.renderId) === event) {
      this.rendersById.delete(event.renderId);
    }
    this.commitsDirty = true;
  }

  /** Re-derive commit summaries from whatever renders remain in the event ring. */
  private rebuildCommitsFromEvents(): void {
    this.commitsCache = null;
    this.commitsById.clear();
    this.commitOrder.clear();
    for (const e of this.events.toArray()) {
      if (e.type === "render") this.recordCommit(e);
    }
    this.commitsDirty = false;
  }

  private recordCommit(event: RenderEvent): void {
    this.commitsCache = null;
    let commit = this.commitsById.get(event.commitId);
    if (!commit) {
      // Evict the oldest commit when the ring wraps.
      if (this.commitOrder.size >= this.config.maxCommits) {
        const evicted = this.commitOrder.toArray()[0];
        if (evicted !== undefined) this.commitsById.delete(evicted);
      }
      commit = {
        commitId: event.commitId,
        timestamp: event.timestamp,
        endTimestamp: event.timestamp,
        components: new Set(),
        totalSelfTime: 0,
        ...(event.interactionId !== undefined ? { interactionId: event.interactionId } : {}),
      };
      this.commitsById.set(event.commitId, commit);
      this.commitOrder.push(event.commitId);
    }
    commit.components.add(event.componentId);
    commit.totalSelfTime += event.selfDuration;
    commit.endTimestamp = Math.max(commit.endTimestamp, event.timestamp);
  }

  private createRenderBuffer(id: ComponentId): RingBuffer<RenderEvent> {
    const buf = new RingBuffer<RenderEvent>(this.config.maxRendersPerComponent);
    this.rendersByComponent.set(id, buf);
    return buf;
  }

  private addSnapshot(snapshot: RenderSnapshot): void {
    // Evict the oldest snapshot when the ring wraps, so the Map stays bounded.
    if (this.snapshotOrder.size >= this.config.maxSnapshots) {
      const evicted = this.snapshotOrder.toArray()[0];
      if (evicted !== undefined) this.snapshots.delete(evicted);
    }
    this.snapshots.set(snapshot.renderId, snapshot);
    this.snapshotOrder.push(snapshot.renderId);
  }

  // ── Queries (the TRACE primitive) ──────────────────────────────────────────

  eventsByInteraction(id: InteractionId): LensEvent[] {
    return this.eventsByInteractionId.get(id) ?? [];
  }

  rendersOf(id: ComponentId): RenderEvent[] {
    return this.rendersByComponent.get(id)?.toArray() ?? [];
  }

  getRender(renderId: RenderId): RenderEvent | undefined {
    return this.rendersById.get(renderId);
  }

  snapshot(renderId: RenderId): RenderSnapshot | undefined {
    return this.snapshots.get(renderId);
  }

  instance(id: ComponentId): ComponentInstance | undefined {
    return this.instances.get(id);
  }

  allInstances(): ComponentInstance[] {
    return [...this.instances.values()];
  }

  /** Lifetime render count (not capped by the history ring buffer). */
  renderCount(id: ComponentId): number {
    return this.renderTotals.get(id) ?? 0;
  }

  selfTimeTotal(id: ComponentId): number {
    return this.selfTimeTotals.get(id) ?? 0;
  }

  allEvents(): LensEvent[] {
    return this.events.toArray();
  }

  /**
   * Ordered commits (oldest→newest) for the timeline / time-travel views.
   * Identity-stable until the next mutation — cheap to call during scrubbing.
   */
  commits(): CommitSummary[] {
    if (this.commitsDirty) this.rebuildCommitsFromEvents();
    if (!this.commitsCache) {
      this.commitsCache = this.commitOrder
        .toArray()
        .map((id) => this.summarize(this.commitsById.get(id)!));
    }
    return this.commitsCache;
  }

  commit(commitId: CommitId): CommitSummary | undefined {
    if (this.commitsDirty) this.rebuildCommitsFromEvents();
    const c = this.commitsById.get(commitId);
    return c ? this.summarize(c) : undefined;
  }

  private summarize(c: MutableCommit): CommitSummary {
    return {
      commitId: c.commitId,
      timestamp: c.timestamp,
      endTimestamp: c.endTimestamp,
      componentIds: [...c.components],
      totalSelfTime: c.totalSelfTime,
      ...(c.interactionId !== undefined ? { interactionId: c.interactionId } : {}),
    };
  }

  /** Interaction-first view of the session (redesign §1-2). */
  interactions(): Interaction[] {
    return buildInteractions(this.events.toArray(), (id) => this.instances.get(id)?.name);
  }

  // ── Time travel (historical resolution) ─────────────────────────────────────

  /** Latest render of a component at or before timestamp `t`. */
  renderAtOrBefore(id: ComponentId, t: number): RenderEvent | undefined {
    const buf = this.rendersByComponent.get(id);
    if (!buf || buf.size === 0) return undefined;
    // Renders are oldest→newest: binary-search the rightmost timestamp ≤ t.
    let lo = 0;
    let hi = buf.size - 1;
    let best: RenderEvent | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = buf.at(mid)!;
      if (r.timestamp <= t) {
        best = r;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  /** Snapshot for the render at or before `t` (may be undefined if not retained). */
  snapshotAtOrBefore(id: ComponentId, t: number): RenderSnapshot | undefined {
    const render = this.renderAtOrBefore(id, t);
    return render ? this.snapshots.get(render.renderId) : undefined;
  }

  /** Nearest commit at or before `t` — the commit whose state the cursor shows. */
  commitAt(t: number): CommitSummary | undefined {
    const commits = this.commits(); // oldest→newest, cached
    let lo = 0;
    let hi = commits.length - 1;
    let best: CommitSummary | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (commits[mid]!.timestamp <= t) {
        best = commits[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  /** Whole-page DOM at or before `t` — offline playback for imported sessions. */
  commitDomAt(t: number): CommitSnapshot | undefined {
    let lo = 0;
    let hi = this.commitSnapshots.size - 1;
    let best: CommitSnapshot | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const cs = this.commitSnapshots.at(mid)!;
      if (cs.timestamp <= t) {
        best = cs;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  stats(): { events: number; renders: number; snapshots: number; components: number } {
    let renders = 0;
    for (const buf of this.rendersByComponent.values()) renders += buf.size;
    return {
      events: this.events.size,
      renders,
      snapshots: this.snapshots.size,
      components: this.instances.size,
    };
  }

  // ── Subscriptions ───────────────────────────────────────────────────────────

  subscribe(selector: TraceSelector, callback: () => void): Dispose {
    const sub: Subscription = { selector, callback };
    this.subscriptions.add(sub);
    return () => {
      this.subscriptions.delete(sub);
    };
  }

  private notify(
    touchedComponents: Set<ComponentId>,
    touchedInteractions: Set<InteractionId>,
  ): void {
    for (const sub of this.subscriptions) {
      if (this.matches(sub.selector, touchedComponents, touchedInteractions)) {
        sub.callback();
      }
    }
  }

  private matches(
    selector: TraceSelector,
    components: Set<ComponentId>,
    interactions: Set<InteractionId>,
  ): boolean {
    switch (selector.kind) {
      case "global":
        return true;
      case "component":
        return components.has(selector.id);
      case "interaction":
        return interactions.has(selector.id);
    }
  }

  clear(): void {
    this.events.clear();
    this.rendersByComponent.clear();
    this.rendersById.clear();
    this.snapshots.clear();
    this.snapshotOrder.clear();
    this.instances.clear();
    this.renderTotals.clear();
    this.selfTimeTotals.clear();
    this.eventsByInteractionId.clear();
    this.commitsById.clear();
    this.commitOrder.clear();
    this.commitSnapshots.clear();
    this.commitsDirty = false;
    this.commitsCache = null;
    // Wake subscribers (Tree/Inspector/Timeline) so they re-render to empty.
    this.notify(new Set(), new Set());
  }
}
