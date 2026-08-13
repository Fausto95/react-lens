import type { ComponentId, ComponentInstance } from "@reactlens/protocol";
import type { PortMessage, SequencedMessage, Unsequenced } from "../transport.js";
import { parseSpillKey, spillKey, type SpillStore } from "./spill.js";

/**
 * Rolling durable buffer for page→panel frames, with a delivery cursor.
 *
 * Capture runs whether or not a panel is listening, so this is where the
 * session lives while DevTools is closed, the tab is in the background, or the
 * MV3 worker has been recycled. Four things make a reconnect lossless:
 *
 *  - Every message gets a monotonic `seq`, and the panel asks for the tail it
 *    is missing (`since`). Replaying the whole buffer instead duplicated every
 *    non-render event and appended stale ones after newer live frames.
 *  - What the ring can no longer hold is *spilled* to a `SpillStore` rather
 *    than dropped. In-memory capacity is seconds on a busy app; the session the
 *    user opens DevTools to look at is minutes long.
 *  - What the panel has durably kept is acknowledged and forgotten here, so in
 *    practice the ring only holds the unacked tail and rarely wraps at all.
 *  - Component instances are folded into a dictionary. The oldest frames are
 *    the mount frames and they carry most instances — without it, a replay
 *    after eviction left the panel ingesting renders for components it could
 *    not place in the tree.
 *
 * Only when the spill store is full too does anything go missing, and then the
 * range is recorded in `compacted` so the panel can say so.
 */

/** Messages per spilled chunk. Big enough to keep write count low. */
export const SPILL_CHUNK = 200;
/** Instances retained in the dictionary; a huge app must not grow it forever. */
const DEFAULT_MAX_INSTANCES = 50_000;

export interface CompactedRange {
  fromSeq: number;
  toSeq: number;
  frames: number;
}

export function createMessageBuffer(
  max = 4000,
  spill?: SpillStore,
  opts: { maxInstances?: number } = {},
) {
  const maxInstances = opts.maxInstances ?? DEFAULT_MAX_INSTANCES;
  let buffer: SequencedMessage[] = [];
  let instances = new Map<ComponentId, ComponentInstance>();
  let seq = 0;
  let sessionId: string | null = null;
  /** Highest seq the panel has durably kept. Everything at or below is dead. */
  let ackedSeq = 0;
  /** Evicted messages awaiting a spill write. */
  let pending: SequencedMessage[] = [];
  /** Spilled ranges we can still read back, ascending. */
  let ranges: Array<{ key: string; loSeq: number; hiSeq: number }> = [];
  /** In-flight spill work, so `since` never reads a half-written session. */
  let inflight: Promise<unknown> = Promise.resolve();
  let compacted: CompactedRange | null = null;

  function reset(nextSessionId: string): void {
    const stale = ranges.map((r) => r.key);
    const previous = sessionId;
    buffer = [];
    instances = new Map();
    pending = [];
    ranges = [];
    seq = 0;
    ackedSeq = 0;
    compacted = null;
    sessionId = nextSessionId;
    // The previous document's chunks are unreadable in this session (its id
    // factories restarted at 1) and would otherwise occupy the quota forever.
    if (spill && previous !== null) {
      track(
        (async () => {
          await spill.remove(stale);
          // Also sweep anything an earlier page load left behind.
          const orphans = (await spill.list()).filter((key) => {
            const parsed = parseSpillKey(key);
            return parsed !== null && parsed.sessionId !== nextSessionId;
          });
          await spill.remove(orphans);
        })(),
      );
    }
  }

  function track(work: Promise<unknown>): void {
    inflight = inflight.then(() => work).catch(() => undefined);
  }

  /** Note that `msgs` could not be retained anywhere. */
  function recordCompaction(msgs: readonly SequencedMessage[]): void {
    if (msgs.length === 0) return;
    const fromSeq = compacted?.fromSeq ?? msgs[0]!.seq;
    const toSeq = msgs[msgs.length - 1]!.seq;
    compacted = { fromSeq, toSeq, frames: (compacted?.frames ?? 0) + msgs.length };
  }

  function flushPending(): void {
    if (!spill || pending.length === 0 || sessionId === null) return;
    const chunk = pending;
    pending = [];
    const loSeq = chunk[0]!.seq;
    const hiSeq = chunk[chunk.length - 1]!.seq;
    const key = spillKey(sessionId, loSeq, hiSeq);
    ranges.push({ key, loSeq, hiSeq });
    track(
      spill.write(key, chunk).catch(() => {
        // Quota exhausted, or the extension context went away. This range is
        // genuinely gone — say so rather than presenting a timeline with a hole.
        ranges = ranges.filter((r) => r.key !== key);
        recordCompaction(chunk);
      }),
    );
  }

  /** Retire everything at or below `ackedSeq` from memory and from the spill. */
  function pruneAcked(): void {
    if (ackedSeq <= 0) return;
    buffer = buffer.filter((m) => m.seq > ackedSeq);
    pending = pending.filter((m) => m.seq > ackedSeq);
    const dead = ranges.filter((r) => r.hiSeq <= ackedSeq);
    if (dead.length === 0) return;
    ranges = ranges.filter((r) => r.hiSeq > ackedSeq);
    if (spill) track(spill.remove(dead.map((r) => r.key)));
  }

  return {
    /** Stamp, retain and return the message the content script should relay. */
    push(msg: Unsequenced<SequencedMessage>): SequencedMessage {
      // A new document means new page-side id factories: nothing from the
      // previous one may be replayed into it.
      if (msg.sessionId !== sessionId) reset(msg.sessionId);

      const stamped = { ...msg, seq: ++seq } as SequencedMessage;
      if (stamped.kind === "frame") {
        for (const instance of stamped.frame.instances) {
          instances.set(instance.id, instance);
          if (instances.size > maxInstances) {
            const oldest = instances.keys().next().value;
            if (oldest !== undefined) instances.delete(oldest);
          }
        }
      }
      buffer.push(stamped);
      if (buffer.length > max) {
        const evicted = buffer.shift()!;
        if (spill) {
          pending.push(evicted);
          if (pending.length >= SPILL_CHUNK) flushPending();
        } else {
          recordCompaction([evicted]);
        }
      }
      return stamped;
    },

    /**
     * The panel has durably kept everything up to `seq`; this copy can go.
     * Retaining acked frames is what makes the ring overflow at all.
     */
    async ack(upToSeq: number): Promise<void> {
      if (upToSeq <= ackedSeq) return;
      ackedSeq = upToSeq;
      pruneAcked();
      await inflight;
    },

    /**
     * Messages the panel has not seen, oldest→newest, spanning the spill. When
     * a range was compacted the tail is prefixed with a synthetic frame
     * carrying every instance we ever saw, so the replay stays placeable.
     */
    async since(fromSeq: number): Promise<readonly PortMessage[]> {
      // A chunk mid-write must be readable, and the partial chunk still in
      // memory has to go out with it.
      flushPending();
      await inflight;

      const out: PortMessage[] = [];
      if (spill) {
        for (const range of [...ranges].sort((a, b) => a.loSeq - b.loSeq)) {
          if (range.hiSeq <= fromSeq) continue;
          const chunk = await spill.read(range.key);
          if (!chunk) continue;
          for (const msg of chunk) {
            if (seqOf(msg) > fromSeq) out.push(msg);
          }
        }
      }
      for (const msg of buffer) {
        if (msg.seq > fromSeq) out.push(msg);
      }

      const lost = compacted;
      if (lost === null || fromSeq >= lost.toSeq || instances.size === 0) return out;
      const dictionary: PortMessage = {
        kind: "frame",
        sessionId: sessionId ?? "",
        seq: lost.fromSeq,
        frame: { events: [], snapshots: [], instances: [...instances.values()] },
      };
      return [dictionary, ...out];
    },

    /** Resolve once every queued spill write / delete has settled. */
    async settled(): Promise<void> {
      flushPending();
      await inflight;
    },

    /** The document these messages belong to, once the page has said hello. */
    get sessionId(): string | null {
      return sessionId;
    },
    get lastSeq(): number {
      return seq;
    },
    get length(): number {
      return buffer.length;
    },
    get instanceCount(): number {
      return instances.size;
    },
    /** The range nothing could retain, or null while the session is intact. */
    get compacted(): CompactedRange | null {
      return compacted;
    },
  };
}

function seqOf(msg: PortMessage): number {
  return msg.kind === "frame" || msg.kind === "hello" ? msg.seq : 0;
}

export type MessageBuffer = ReturnType<typeof createMessageBuffer>;
