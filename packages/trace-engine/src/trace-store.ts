import type {
  LensEvent,
  RenderEvent,
  ComponentId,
  ComponentInstance,
  InteractionId,
  RenderId,
  RenderSnapshot,
  EventsBatchMessage,
} from "@react-lens/protocol";
import { RingBuffer } from "./ring-buffer.js";

export interface TraceStoreConfig {
  maxEvents: number;
  maxRendersPerComponent: number;
  maxSnapshots: number;
}

const DEFAULTS: TraceStoreConfig = {
  maxEvents: 10_000,
  maxRendersPerComponent: 100,
  maxSnapshots: 5_000,
};

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
  private readonly subscriptions = new Set<Subscription>();

  constructor(config?: Partial<TraceStoreConfig>) {
    this.config = { ...DEFAULTS, ...config };
    this.events = new RingBuffer<LensEvent>(this.config.maxEvents);
    this.snapshotOrder = new RingBuffer<RenderId>(this.config.maxSnapshots);
  }

  ingest(batch: EventsBatchMessage["payload"]): void {
    for (const instance of batch.instances) {
      this.instances.set(instance.id, instance);
    }
    for (const snapshot of batch.snapshots) {
      this.addSnapshot(snapshot);
    }
    const touched = new Set<ComponentId>();
    const touchedInteractions = new Set<InteractionId>();
    for (const event of batch.events) {
      this.addEvent(event);
      if (event.componentId !== undefined) touched.add(event.componentId);
      if (event.interactionId !== undefined) touchedInteractions.add(event.interactionId);
    }
    this.notify(touched, touchedInteractions);
  }

  private addEvent(event: LensEvent): void {
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
    }
    if (event.interactionId !== undefined) {
      const list = this.eventsByInteractionId.get(event.interactionId) ?? [];
      list.push(event);
      this.eventsByInteractionId.set(event.interactionId, list);
    }
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
  }
}
