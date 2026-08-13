/**
 * Flattened component-tree columns for viewport queries.
 * React only mounts overscan-visible rows — never the full tree.
 */

export interface FlatTreeColumns {
  count: number;
  ids: Uint32Array;
  parent: Int32Array;
  depth: Uint16Array;
  /** Bit flags: see TreeFlags. */
  flags: Uint8Array;
  renders: Uint32Array;
  selfTime: Float32Array;
  names: string[];
}

export const TreeFlags = {
  None: 0,
  Compiled: 1 << 0,
  /** Last render had no observable DOM change. */
  WastedLast: 1 << 1,
  ChangedLast: 1 << 2,
  Expandable: 1 << 3,
} as const;

export interface FlatTreeNodeInput {
  id: number;
  parentId?: number;
  name: string;
  renders: number;
  selfTime: number;
  compiled: boolean;
  /** true = changed, false = wasted, null = unknown */
  observableChange?: boolean | null;
}

export interface VisibleTreeRow {
  index: number;
  id: number;
  key: string;
  depth: number;
  name: string;
  renders: number;
  selfTime: number;
  compiled: boolean;
  expandable: boolean;
  expanded: boolean;
  observableChange: boolean | null;
  /** Child count among tree edges (not filtered). */
  childCount: number;
}

/**
 * Ownership tree stored as parallel arrays + adjacency for flatten.
 * Built incrementally as instances arrive; `rebuildOrder` after parent links change.
 */
export class FlatTreeIndex {
  count = 0;
  ids = new Uint32Array(64);
  parent = new Int32Array(64);
  depth = new Uint16Array(64);
  flags = new Uint8Array(64);
  renders = new Uint32Array(64);
  selfTime = new Float32Array(64);
  names: string[] = [];
  private idToIndex = new Map<number, number>();
  /** children of each index */
  private children: number[][] = [];
  /** Preorder roots (parent < 0 or missing). */
  private roots: number[] = [];

  upsert(input: FlatTreeNodeInput): void {
    let idx = this.idToIndex.get(input.id);
    if (idx === undefined) {
      idx = this.count;
      this.ensure(idx + 1);
      this.ids[idx] = input.id;
      this.idToIndex.set(input.id, idx);
      this.names[idx] = input.name;
      this.children[idx] = [];
      this.parent[idx] = -1;
      this.count = idx + 1;
    }
    this.names[idx] = input.name;
    this.renders[idx] = input.renders;
    this.selfTime[idx] = input.selfTime;
    let f = 0;
    if (input.compiled) f |= TreeFlags.Compiled;
    if (input.observableChange === false) f |= TreeFlags.WastedLast;
    if (input.observableChange === true) f |= TreeFlags.ChangedLast;
    this.flags[idx] = f;

    const parentIdx =
      input.parentId !== undefined ? (this.idToIndex.get(input.parentId) ?? -1) : -1;
    this.parent[idx] = parentIdx;
  }

  setLastObservable(id: number, observable: boolean | null): void {
    const idx = this.idToIndex.get(id);
    if (idx === undefined) return;
    let f = this.flags[idx]! & ~(TreeFlags.WastedLast | TreeFlags.ChangedLast);
    if (observable === false) f |= TreeFlags.WastedLast;
    else if (observable === true) f |= TreeFlags.ChangedLast;
    this.flags[idx] = f;
  }

  indexOf(id: number): number {
    return this.idToIndex.get(id) ?? -1;
  }

  lastObservable(id: number): boolean | null {
    const idx = this.idToIndex.get(id);
    if (idx === undefined) return null;
    const f = this.flags[idx]!;
    if (f & TreeFlags.WastedLast) return false;
    if (f & TreeFlags.ChangedLast) return true;
    return null;
  }

  /** Rebuild child lists + depths from parent pointers. Call after batch upserts. */
  rebuildOrder(): void {
    this.children = Array.from({ length: this.count }, () => []);
    this.roots = [];
    for (let i = 0; i < this.count; i++) {
      const p = this.parent[i]!;
      if (p < 0 || p >= this.count) this.roots.push(i);
      else this.children[p]!.push(i);
    }
    const visit = (i: number, d: number) => {
      this.depth[i] = d;
      const kids = this.children[i]!;
      if (kids.length > 0) this.flags[i] = this.flags[i]! | TreeFlags.Expandable;
      else this.flags[i] = this.flags[i]! & ~TreeFlags.Expandable;
      for (const c of kids) visit(c, d + 1);
    };
    for (const r of this.roots) visit(r, 0);
  }

  private ensure(need: number): void {
    if (need <= this.ids.length) return;
    let n = this.ids.length || 64;
    while (n < need) n *= 2;
    const growU32 = (a: Uint32Array) => {
      const b = new Uint32Array(n);
      b.set(a);
      return b;
    };
    const growI32 = (a: Int32Array) => {
      const b = new Int32Array(n);
      b.set(a);
      return b;
    };
    const growU16 = (a: Uint16Array) => {
      const b = new Uint16Array(n);
      b.set(a);
      return b;
    };
    const growU8 = (a: Uint8Array) => {
      const b = new Uint8Array(n);
      b.set(a);
      return b;
    };
    const growF32 = (a: Float32Array) => {
      const b = new Float32Array(n);
      b.set(a);
      return b;
    };
    this.ids = growU32(this.ids);
    this.parent = growI32(this.parent);
    this.depth = growU16(this.depth);
    this.flags = growU8(this.flags);
    this.renders = growU32(this.renders);
    this.selfTime = growF32(this.selfTime);
  }

  clear(): void {
    this.count = 0;
    this.ids = new Uint32Array(64);
    this.parent = new Int32Array(64);
    this.depth = new Uint16Array(64);
    this.flags = new Uint8Array(64);
    this.renders = new Uint32Array(64);
    this.selfTime = new Float32Array(64);
    this.names = [];
    this.idToIndex.clear();
    this.children = [];
    this.roots = [];
  }

  /**
   * Flatten respecting expansion. Returns only the window [start, end).
   * `expanded` holds component keys `c:${id}`.
   */
  queryWindow(args: {
    expanded: ReadonlySet<string>;
    scrollTop: number;
    viewH: number;
    rowHeight: number;
    overscan?: number;
    /** Projection: keep node if true, or if ancestor of a match. */
    include?: (index: number) => boolean;
  }): { rows: VisibleTreeRow[]; totalRows: number; totalHeight: number } {
    const overscan = args.overscan ?? 10;
    const rowHeight = args.rowHeight;
    const start = Math.max(0, Math.floor(args.scrollTop / rowHeight) - overscan);
    const end = Math.max(start, Math.ceil((args.scrollTop + args.viewH) / rowHeight) + overscan);
    const rows: VisibleTreeRow[] = [];
    const keepMemo = new Map<number, boolean>();
    const shouldKeep = (i: number): boolean => {
      if (!args.include) return true;
      const cached = keepMemo.get(i);
      if (cached !== undefined) return cached;
      let keep = args.include(i);
      if (!keep) {
        for (const c of this.children[i] ?? []) {
          if (shouldKeep(c)) {
            keep = true;
            break;
          }
        }
      }
      keepMemo.set(i, keep);
      return keep;
    };
    let totalRows = 0;
    const pushRow = (i: number, index: number): void => {
      const id = this.ids[i]!;
      const key = `c:${id}`;
      const f = this.flags[i]!;
      let observableChange: boolean | null = null;
      if (f & TreeFlags.WastedLast) observableChange = false;
      else if (f & TreeFlags.ChangedLast) observableChange = true;
      rows.push({
        index,
        id,
        key,
        depth: this.depth[i]!,
        name: this.names[i] ?? `#${id}`,
        renders: this.renders[i]!,
        selfTime: this.selfTime[i]!,
        compiled: (f & TreeFlags.Compiled) !== 0,
        expandable: (f & TreeFlags.Expandable) !== 0,
        expanded: args.expanded.has(key),
        observableChange,
        childCount: this.children[i]?.length ?? 0,
      });
    };
    const walk = (i: number) => {
      if (!shouldKeep(i)) return;
      const index = totalRows++;
      if (index >= start && index < end) pushRow(i, index);
      const id = this.ids[i]!;
      const key = `c:${id}`;
      const expandable = (this.flags[i]! & TreeFlags.Expandable) !== 0;
      if (expandable && args.expanded.has(key)) {
        for (const c of this.children[i] ?? []) walk(c);
      }
    };
    for (const r of this.roots) walk(r);

    return { rows, totalRows, totalHeight: totalRows * rowHeight };
  }
}
