import type {
  LensEvent,
  RenderEvent,
  InteractionEvent,
  ComponentId,
  RenderId,
  CommitId,
} from "@reactlens/protocol";

/**
 * The interaction is the timeline's primary unit (redesign §1-2): developers
 * think "I clicked X and the list re-rendered", not "commit #26 happened". This
 * derives interactions from the raw event log — one per captured user
 * interaction, a leading synthetic "Load" for the initial mount, and gap-based
 * "Background" buckets for orphan renders (tickers/timers) that no interaction
 * tagged. Pure and deterministic so it's unit-testable and worker-safe.
 */
export interface InteractionMetrics {
  /** Wall-clock span of the interaction (ms). */
  totalDuration: number;
  /** Sum of self-durations across its renders (ms). */
  reactDuration: number;
  renderCount: number;
  /** Renders whose reason includes a state update. */
  stateUpdates: number;
  /** Unique components that rendered during the interaction. */
  componentIds: ComponentId[];
}

export type InteractionKind = InteractionEvent["kind"] | "load" | "system";

export interface Interaction {
  id: string;
  label: string;
  kind: InteractionKind;
  start: number;
  end: number;
  renderIds: RenderId[];
  commitIds: CommitId[];
  metrics: InteractionMetrics;
}

/** Orphan renders more than this far apart start a new Background interaction. */
const BACKGROUND_GAP_MS = 250;
/** An orphan render within this window after an interaction attaches to it. */
const ATTACH_WINDOW_MS = 300;

export function buildInteractions(
  events: readonly LensEvent[],
  nameOf: (id: ComponentId) => string | undefined,
): Interaction[] {
  const interactionEvents = events
    .filter((e): e is InteractionEvent => e.type === "interaction")
    .sort((a, b) => a.timestamp - b.timestamp);
  const renders = events
    .filter((e): e is RenderEvent => e.type === "render")
    .sort((a, b) => a.timestamp - b.timestamp);

  // Seed the model: one bucket per interaction event, keyed by its id.
  const buckets: MutableBucket[] = [];
  const byInteractionId = new Map<number, MutableBucket>();
  for (const ev of interactionEvents) {
    const targetName = ev.target?.componentId != null ? nameOf(ev.target.componentId) : undefined;
    const bucket: MutableBucket = {
      id: `i${ev.interactionId}`,
      kind: ev.kind,
      label: labelFor(ev.kind, targetName),
      start: ev.timestamp,
      end: ev.timestamp,
      renders: [],
    };
    buckets.push(bucket);
    byInteractionId.set(ev.interactionId as unknown as number, bucket);
  }

  const firstInteractionAt = interactionEvents[0]?.timestamp ?? Infinity;
  let orphan: MutableBucket | null = null;
  let orphanCount = 0;
  let lastOrphanAt = -Infinity;

  for (const r of renders) {
    // 1. Explicitly attributed to an interaction.
    const tagged =
      r.interactionId != null
        ? byInteractionId.get(r.interactionId as unknown as number)
        : undefined;
    if (tagged) {
      pushRender(tagged, r);
      continue;
    }
    // 2. Untagged but within the tail of a recent interaction → attach to it.
    const near = nearestPreceding(buckets, r.timestamp);
    if (near && r.timestamp - near.end <= ATTACH_WINDOW_MS) {
      pushRender(near, r);
      continue;
    }
    // 3. A true orphan (mount burst, ticker, timer). Group runs by idle gap so
    //    each burst is its own block and the idle between them can compress.
    //    The first burst before any interaction is the initial mount → "Load".
    if (!orphan || r.timestamp - lastOrphanAt > BACKGROUND_GAP_MS) {
      orphanCount++;
      const isLoad = orphanCount === 1 && r.timestamp <= firstInteractionAt;
      orphan = {
        id: isLoad ? "load" : `sys${r.renderId}`,
        kind: isLoad ? "load" : "system",
        label: isLoad ? "Load" : "Background",
        start: r.timestamp,
        end: r.timestamp,
        renders: [],
      };
      buckets.push(orphan);
    }
    pushRender(orphan, r);
    lastOrphanAt = r.timestamp;
  }

  return buckets
    .filter((b) => b.renders.length > 0)
    .sort((a, b) => a.start - b.start)
    .map(finalize);
}

interface MutableBucket {
  id: string;
  kind: InteractionKind;
  label: string;
  start: number;
  end: number;
  renders: RenderEvent[];
}

function pushRender(bucket: MutableBucket, r: RenderEvent): void {
  bucket.renders.push(r);
  bucket.end = Math.max(bucket.end, r.timestamp + r.selfDuration);
}

/** Latest real interaction that started at or before `t` (excludes load/system). */
function nearestPreceding(buckets: MutableBucket[], t: number): MutableBucket | null {
  let best: MutableBucket | null = null;
  for (const b of buckets) {
    if (b.kind === "system" || b.kind === "load") continue;
    if (b.start <= t && (!best || b.start > best.start)) best = b;
  }
  return best;
}

function finalize(b: MutableBucket): Interaction {
  const componentIds = new Set<ComponentId>();
  const commitIds = new Set<CommitId>();
  let reactDuration = 0;
  let stateUpdates = 0;
  for (const r of b.renders) {
    componentIds.add(r.componentId);
    commitIds.add(r.commitId);
    reactDuration += r.selfDuration;
    if (r.reasons.some((x) => x.type === "state")) stateUpdates++;
  }
  return {
    id: b.id,
    label: b.label,
    kind: b.kind,
    start: b.start,
    end: b.end,
    renderIds: b.renders.map((r) => r.renderId),
    commitIds: [...commitIds],
    metrics: {
      totalDuration: Math.max(0, b.end - b.start),
      reactDuration,
      renderCount: b.renders.length,
      stateUpdates,
      componentIds: [...componentIds],
    },
  };
}

function labelFor(kind: InteractionEvent["kind"], targetName: string | undefined): string {
  const verb = KIND_VERB[kind];
  return targetName ? `${verb} ${targetName}` : verb;
}

const KIND_VERB: Record<InteractionEvent["kind"], string> = {
  click: "Click",
  keypress: "Type",
  submit: "Submit",
  navigation: "Navigate",
  hover: "Hover",
  drag: "Drag",
  transition: "Transition",
};
