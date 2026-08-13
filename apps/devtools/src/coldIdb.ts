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
  /** Serialized ArrayBuffers as plain arrays for IDB. */
  timestamps: number[];
  durations: number[];
  selfDurations: number[];
  renderIds: number[];
  componentIds: number[];
  commitIds: number[];
  causes: number[];
  flags: number[];
  laneKeys: string[];
  laneIndices: number[];
}

function encode(chunk: ColumnarChunk, id: string): ColdRecord {
  return {
    id,
    t0: chunk.t0,
    t1: chunk.t1,
    count: chunk.count,
    timestamps: [...chunk.timestamps],
    durations: [...chunk.durations],
    selfDurations: [...chunk.selfDurations],
    renderIds: [...chunk.renderIds],
    componentIds: [...chunk.componentIds],
    commitIds: [...chunk.commitIds],
    causes: [...chunk.causes],
    flags: [...chunk.flags],
    laneKeys: chunk.laneKeys,
    laneIndices: [...chunk.laneIndices],
  };
}

function decode(rec: ColdRecord): ColumnarChunk {
  return {
    t0: rec.t0,
    t1: rec.t1,
    count: rec.count,
    timestamps: Float64Array.from(rec.timestamps),
    durations: Float32Array.from(rec.durations),
    selfDurations: Float32Array.from(rec.selfDurations),
    renderIds: Uint32Array.from(rec.renderIds),
    componentIds: Uint32Array.from(rec.componentIds),
    commitIds: Uint32Array.from(rec.commitIds),
    causes: Uint8Array.from(rec.causes),
    flags: Uint8Array.from(rec.flags),
    laneKeys: rec.laneKeys,
    laneIndices: Int32Array.from(rec.laneIndices),
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
