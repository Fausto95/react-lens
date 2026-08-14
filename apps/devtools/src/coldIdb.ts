/**
 * IndexedDB cold store for tiered columnar retention.
 * Separate from the WAL (`react-lens-wal`) — this is the query archive.
 */

import type { ColdStore, ColumnarChunk } from "@reactlens/trace-engine";

const DB_NAME = "react-lens-cold";
const DB_VERSION = 1;
const STORE = "chunks";

interface ColdRecord {
  id: string;
  t0: number;
  t1: number;
  count: number;
  /** Typed-array payloads stored as structured-clonable buffers. */
  timestamps: ArrayBuffer | number[];
  durations: ArrayBuffer | number[];
  selfDurations: ArrayBuffer | number[];
  renderIds: ArrayBuffer | number[];
  componentIds: ArrayBuffer | number[];
  commitIds: ArrayBuffer | number[];
  causes: ArrayBuffer | number[];
  flags: ArrayBuffer | number[];
  laneKeys: string[];
  laneIndices: ArrayBuffer | number[];
}

function exactBuffer(view: ArrayBufferView): ArrayBuffer {
  if (
    view.buffer instanceof ArrayBuffer &&
    view.byteOffset === 0 &&
    view.byteLength === view.buffer.byteLength
  ) {
    return view.buffer;
  }
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return out;
}

function fromBufferOrArray<
  T extends Float64Array | Float32Array | Uint32Array | Uint8Array | Int32Array,
>(
  value: ArrayBuffer | number[],
  ctor: {
    from(values: ArrayLike<number>): T;
    new (buffer: ArrayBuffer): T;
  },
): T {
  return value instanceof ArrayBuffer ? new ctor(value) : ctor.from(value);
}

function encode(chunk: ColumnarChunk, id: string): ColdRecord {
  return {
    id,
    t0: chunk.t0,
    t1: chunk.t1,
    count: chunk.count,
    timestamps: exactBuffer(chunk.timestamps),
    durations: exactBuffer(chunk.durations),
    selfDurations: exactBuffer(chunk.selfDurations),
    renderIds: exactBuffer(chunk.renderIds),
    componentIds: exactBuffer(chunk.componentIds),
    commitIds: exactBuffer(chunk.commitIds),
    causes: exactBuffer(chunk.causes),
    flags: exactBuffer(chunk.flags),
    laneKeys: chunk.laneKeys,
    laneIndices: exactBuffer(chunk.laneIndices),
  };
}

function decode(rec: ColdRecord): ColumnarChunk {
  return {
    t0: rec.t0,
    t1: rec.t1,
    count: rec.count,
    timestamps: fromBufferOrArray(rec.timestamps, Float64Array),
    durations: fromBufferOrArray(rec.durations, Float32Array),
    selfDurations: fromBufferOrArray(rec.selfDurations, Float32Array),
    renderIds: fromBufferOrArray(rec.renderIds, Uint32Array),
    componentIds: fromBufferOrArray(rec.componentIds, Uint32Array),
    commitIds: fromBufferOrArray(rec.commitIds, Uint32Array),
    causes: fromBufferOrArray(rec.causes, Uint8Array),
    flags: fromBufferOrArray(rec.flags, Uint8Array),
    laneKeys: rec.laneKeys,
    laneIndices: fromBufferOrArray(rec.laneIndices, Int32Array),
  };
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => resolve(null);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("t0", "t0");
        }
      };
      req.onsuccess = () => resolve(req.result);
    } catch {
      resolve(null);
    }
  });
}

/** Returns null when IndexedDB is unavailable (tests / SSR). */
export async function createIdbColdStore(): Promise<ColdStore | null> {
  const db = await openDb();
  if (!db) return null;
  let seq = 0;

  return {
    async put(chunk) {
      const id = `cold:${Date.now()}:${seq++}`;
      const rec = encode(chunk, id);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("cold put failed"));
      });
      return id;
    },
    async get(id) {
      const rec = await new Promise<ColdRecord | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result as ColdRecord | undefined);
        req.onerror = () => reject(req.error ?? new Error("cold get failed"));
      });
      return rec ? decode(rec) : null;
    },
    async delete(id) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("cold delete failed"));
      });
    },
    async list() {
      const all = await new Promise<ColdRecord[]>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as ColdRecord[]) ?? []);
        req.onerror = () => reject(req.error ?? new Error("cold list failed"));
      });
      return all.map((r) => ({ id: r.id, t0: r.t0, t1: r.t1 }));
    },
  };
}
