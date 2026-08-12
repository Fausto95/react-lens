import type { PortMessage } from "../transport.js";

/**
 * Rolling durable buffer for page→panel frames.
 * Survives service-worker restarts; drops oldest when full.
 */
export function createMessageBuffer(max = 4000) {
  const buffer: PortMessage[] = [];

  return {
    push(msg: PortMessage): void {
      buffer.push(msg);
      if (buffer.length > max) buffer.shift();
    },
    /** Snapshot for replay (oldest → newest). */
    snapshot(): readonly PortMessage[] {
      return buffer.slice();
    },
    get length(): number {
      return buffer.length;
    },
    clear(): void {
      buffer.length = 0;
    },
  };
}

export type MessageBuffer = ReturnType<typeof createMessageBuffer>;
