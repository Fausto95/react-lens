import type {
  LensEvent,
  RenderEvent,
  ComponentId,
  ComponentInstance,
  InteractionId,
  RenderId,
  CommitId,
  RenderSnapshot,
  EventsBatchMessage,
} from "@react-lens/protocol";
import { RingBuffer } from "./ring-buffer.js";
import { buildInteractions, type Interaction } from "./interactions.js";

/** A single commit pass: which components rendered, when. */
export interface CommitSummary {
  commitId: CommitId;
  timestamp: number;
  componentIds: ComponentId[];
  interactionId?: InteractionId;
  totalSelfTime: number;
}

export interface TraceStoreConfig {
  maxEvents: number;
  maxRendersPerComponent: number;
  maxSnapshots: number;
  maxCommits: number;
}

const DEFAULTS: TraceStoreConfig = {
  maxEvents: 10_000,
  maxRendersPerComponent: 100,
  maxSnapshots: 5_000,
  maxCommits: 1_000,
};

interface MutableCommit {
  commitId: CommitId;
  timestamp: number;
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
  private readonly subscriptions = new Set<Subscription>();
  private readonly ingestObservers = new Set<(batch: EventsBatchMessage["payload"]) => void>();

  constructor(config?: Partial<TraceStoreConfig>) {
    this.config = { ...DEFAULTS, ...config };
    this.events = new RingBuffer<LensEvent>(this.config.maxEvents);
    this.snapshotOrder = new RingBuffer<RenderId>(this.config.maxSnapshots);
    this.commitOrder = new RingBuffer<CommitId>(this.config.maxCommits);
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
    for (const event of batch.events) {
      this.addEvent(event);
      if (event.componentId !== undefined) touched.add(event.componentId);
      if (event.interactionId !== undefined) touchedInteractions.add(event.interactionId);
    }
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
    };
  }

  private addEvent(event: LensEvent): void {
    // Idempotent on renderId: the content-script buffer can replay (e.g. after a
    // panel reconnect), and re-ingesting the same render must not double-count.
    if (event.type === "render" && this.rendersById.has(event.renderId)) return;
    this.events.push(event);
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

  private recordCommit(event: RenderEvent): void {
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
        components: new Set(),
        totalSelfTime: 0,
        ...(event.interactionId !== undefined ? { interactionId: event.interactionId } : {}),
      };
      this.commitsById.set(event.commitId, commit);
      this.commitOrder.push(event.commitId);
    }
    commit.components.add(event.componentId);
    commit.totalSelfTime += event.selfDuration;
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

  /** Ordered commits (oldest→newest) for the timeline / time-travel views. */
  commits(): CommitSummary[] {
    return this.commitOrder.toArray().map((id) => {
      const c = this.commitsById.get(id)!;
      return {
        commitId: c.commitId,
        timestamp: c.timestamp,
        componentIds: [...c.components],
        totalSelfTime: c.totalSelfTime,
        ...(c.interactionId !== undefined ? { interactionId: c.interactionId } : {}),
      };
    });
  }

  commit(commitId: CommitId): CommitSummary | undefined {
    return this.commits().find((c) => c.commitId === commitId);
  }

  /** Interaction-first view of the session (redesign §1-2). */
  interactions(): Interaction[] {
    return buildInteractions(this.events.toArray(), (id) => this.instances.get(id)?.name);
  }

  // ── Time travel (historical resolution) ─────────────────────────────────────

  /** Latest render of a component at or before timestamp `t`. */
  renderAtOrBefore(id: ComponentId, t: number): RenderEvent | undefined {
    const renders = this.rendersByComponent.get(id)?.toArray();
    if (!renders) return undefined;
    let best: RenderEvent | undefined;
    for (const r of renders) {
      if (r.timestamp <= t) best = r; // renders are oldest→newest
      else break;
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
    const commits = this.commits(); // oldest→newest
    let best: CommitSummary | undefined;
    for (const c of commits) {
      if (c.timestamp <= t) best = c;
      else break;
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
    // Wake subscribers (Tree/Inspector/Timeline) so they re-render to empty.
    this.notify(new Set(), new Set());
  }
}
