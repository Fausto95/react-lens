import type { WalRecord, WalStore } from "./wal.js";

/**
 * IndexedDB backing for the write-ahead log.
 *
 * Its own database, and one connection held open for the panel's lifetime: the
 * saved-sessions store opens and closes per call, which is fine a few times a
 * session and far too slow for something on the ingest path.
 *
 * Returns null wherever IndexedDB is unavailable or blocked (a worker without
 * it, private mode, a locked profile). The panel then runs exactly as it did
 * before — in memory, with nothing to recover — instead of failing to start.
 */
const DB_NAME = "react-lens-wal";
const DB_VERSION = 1;
const STORE = "frames";

export async function createIdbWalStore(): Promise<WalStore | null> {
  if (typeof indexedDB === "undefined") return null;
  let db: IDBDatabase;
  try {
    db = await open();
  } catch {
    return null;
  }

  const tx = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);

  return {
    put(id, record) {
      return request(tx("readwrite").put(record, id)).then(() => undefined);
    },
    async all() {
      const store = tx("readonly");
      const [keys, values] = await Promise.all([
        request(store.getAllKeys()),
        request(store.getAll()),
      ]);
      return (values as WalRecord[])
        .map((record, i) => ({ id: Number(keys[i]), record }))
        .sort((a, b) => a.id - b.id);
    },
    async delete(ids) {
      if (ids.length === 0) return;
      const store = tx("readwrite");
      await Promise.all(ids.map((id) => request(store.delete(id))));
    },
    async clear() {
      await request(tx("readwrite").clear());
    },
  };
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("WAL database unavailable"));
    req.onblocked = () => reject(new Error("WAL database blocked by another panel"));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("WAL request failed"));
  });
}
