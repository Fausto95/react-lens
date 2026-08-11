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

  /** Returns the overwritten oldest item when the buffer was already full. */
  push(item: T): T | undefined {
    const evicted =
      this.count === this.capacity ? (this.items[this.head] as T) : undefined;
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    return evicted;
  }

  get size(): number {
    return this.count;
  }

  /** Random access, oldest→newest (0 = oldest). Undefined out of range. */
  at(i: number): T | undefined {
    if (i < 0 || i >= this.count) return undefined;
    const start = this.count < this.capacity ? 0 : this.head;
    return this.items[(start + i) % this.capacity] as T;
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
