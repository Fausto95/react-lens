import type { ComponentId, ComponentInstance } from "@reactlens/protocol";
import type { PortMessage, SequencedMessage, Unsequenced } from "../transport.js";

/**
 * Rolling durable buffer for page→panel frames, with a delivery cursor.
 *
 * Capture runs whether or not a panel is listening, so this is where the
 * session lives while DevTools is closed, the tab is in the background, or the
 * MV3 worker has been recycled. Two things make a reconnect lossless:
 *
 *  - Every message gets a monotonic `seq`, and the panel asks for the tail it
 *    is missing (`since`). Replaying the whole buffer instead duplicated every
 *    non-render event and appended stale ones after newer live frames.
 *  - Component instances are folded into a dictionary that is never evicted.
 *    The oldest frames are the mount frames, and they carry most instances —
 *    once the ring wrapped, the panel was left ingesting renders for components
 *    it could not place in the tree.
 */
export function createMessageBuffer(max = 4000) {
  let buffer: PortMessage[] = [];
  let instances = new Map<ComponentId, ComponentInstance>();
  let seq = 0;
  /** Lowest seq still held; anything older is only in the dictionary. */
  let oldestSeq = 1;
  let sessionId: string | null = null;

  function reset(nextSessionId: string): void {
    buffer = [];
    instances = new Map();
    seq = 0;
    oldestSeq = 1;
    sessionId = nextSessionId;
  }

  return {
    /** Stamp, retain and return the message the content script should relay. */
    push(msg: Unsequenced<SequencedMessage>): SequencedMessage {
      // A new document means new page-side id factories: nothing from the
      // previous one may be replayed into it.
      if (msg.sessionId !== sessionId) reset(msg.sessionId);

      const stamped = { ...msg, seq: ++seq } as SequencedMessage;
      if (stamped.kind === "frame") {
        for (const instance of stamped.frame.instances) instances.set(instance.id, instance);
      }
      buffer.push(stamped);
      if (buffer.length > max) {
        buffer.shift();
        oldestSeq++;
      }
      return stamped;
    },

    /**
     * Messages the panel has not seen, oldest→newest. When the ring has already
     * dropped part of that range, the tail is prefixed with a synthetic frame
     * carrying every instance we ever saw, so the replay stays placeable.
     */
    since(fromSeq: number): readonly PortMessage[] {
      const tail = buffer.filter((m) => seqOf(m) > fromSeq);
      const droppedSome = fromSeq < oldestSeq - 1;
      if (!droppedSome || instances.size === 0) return tail;
      const dictionary: PortMessage = {
        kind: "frame",
        sessionId: sessionId ?? "",
        seq: oldestSeq - 1,
        frame: { events: [], snapshots: [], instances: [...instances.values()] },
      };
      return [dictionary, ...tail];
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
  };
}

function seqOf(msg: PortMessage): number {
  return msg.kind === "frame" || msg.kind === "hello" ? msg.seq : 0;
}

export type MessageBuffer = ReturnType<typeof createMessageBuffer>;
