/**
 * Fixed-capacity ring buffer. Appends are O(1); when full, the oldest entry is
 * overwritten. Bounds memory so we never retain the app's entire history
 * (DESIGN §1.3 / §5).
 */
export class RingBuffer<T> {
  private readonly items: Array<T | undefined>;
  private head = 0; // index of the next write
  private count = 0;

  constructor(readonly capacity: number) {
    if (capacity <= 0) throw new Error("RingBuffer capacity must be > 0");
    this.items = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  get size(): number {
    return this.count;
  }

  /** Oldest → newest. */
  toArray(): T[] {
    const out: T[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      out.push(this.items[(start + i) % this.capacity] as T);
    }
    return out;
  }

  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}
