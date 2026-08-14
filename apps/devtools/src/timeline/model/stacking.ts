export interface StackInterval<Key> {
  key: Key;
  start: number;
  end: number;
}

export interface PackedIntervals<Key> {
  slots: ReadonlyMap<Key, number>;
  depth: number;
}

interface ActiveSlot {
  end: number;
  slot: number;
}

function heapPush(heap: ActiveSlot[], value: ActiveSlot): void {
  let i = heap.length;
  heap.push(value);
  while (i > 0) {
    const parent = (i - 1) >>> 1;
    if (heap[parent]!.end <= value.end) break;
    heap[i] = heap[parent]!;
    i = parent;
  }
  heap[i] = value;
}

function heapPop(heap: ActiveSlot[]): ActiveSlot | undefined {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last || heap.length === 0) return first;
  let i = 0;
  while (true) {
    const left = i * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child = right < heap.length && heap[right]!.end < heap[left]!.end ? right : left;
    if (heap[child]!.end >= last.end) break;
    heap[i] = heap[child]!;
    i = child;
  }
  heap[i] = last;
  return first;
}

/**
 * Minimum interval partitioning for timeline bars.
 *
 * Invariant: intervals that overlap in wall time never share a vertical slot.
 * Adjacent intervals (`previous.end <= next.start`) may reuse a slot.
 * Cause/type is deliberately irrelevant.
 *
 * Complexity: O(n log d), where d is maximum overlap depth.
 */
export function packIntervals<Key>(items: readonly StackInterval<Key>[]): PackedIntervals<Key> {
  const ordered = items.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const slots = new Map<Key, number>();
  const active: ActiveSlot[] = [];
  const freeSlots: number[] = [];
  let depth = 0;

  for (const item of ordered) {
    while (active[0] && active[0].end <= item.start) {
      const freed = heapPop(active)!;
      freeSlots.push(freed.slot);
    }

    const slot = freeSlots.length > 0 ? freeSlots.pop()! : depth++;
    slots.set(item.key, slot);
    heapPush(active, { end: Math.max(item.end, item.start), slot });
  }

  return { slots, depth: Math.max(1, depth) };
}
