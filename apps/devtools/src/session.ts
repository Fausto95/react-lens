import type { TraceStore } from "@reactlens/trace-engine";
import { PROTOCOL_VERSION, type EventsBatchMessage } from "@reactlens/protocol";

/** On-disk / IDB session format — TraceStore export plus protocol version. */
export interface LensSessionFile {
  protocolVersion: typeof PROTOCOL_VERSION;
  exportedAt: string;
  payload: EventsBatchMessage["payload"];
  meta?: {
    title?: string;
    pageUrl?: string;
  };
}

export interface SessionListEntry {
  id: string;
  title: string;
  exportedAt: string;
  updatedAt: string;
  protocolVersion: number;
  eventCount: number;
  snapshotCount: number;
  instanceCount: number;
  byteSize: number;
  pageUrl?: string;
}

const DB_NAME = "react-lens-sessions";
const DB_VERSION = 1;
const STORE = "sessions";
const MAX_RECENT = 20;

export function exportSession(store: TraceStore, meta?: LensSessionFile["meta"]): LensSessionFile {
  return {
    protocolVersion: PROTOCOL_VERSION,
    exportedAt: new Date().toISOString(),
    payload: store.export(),
    ...(meta ? { meta } : {}),
  };
}

export function downloadSession(store: TraceStore, filename = "react-lens-session.json"): void {
  const session = exportSession(store, {
    title: filename,
    pageUrl: typeof location !== "undefined" ? location.href : undefined,
  });
  const body = JSON.stringify(session, null, 2);
  const blob = new Blob([body], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  void saveSessionToIdb(session).catch(() => {
    /* IDB optional */
  });
}

export function parseSessionFile(raw: string): LensSessionFile {
  const data = JSON.parse(raw) as LensSessionFile;
  if (
    !data ||
    data.protocolVersion !== PROTOCOL_VERSION ||
    !data.payload ||
    !Array.isArray(data.payload.events)
  ) {
    throw new Error("Invalid React Lens session file");
  }
  return data;
}

export function importSession(store: TraceStore, session: LensSessionFile): void {
  store.clear();
  store.ingest(session.payload);
}

export async function importSessionFromFile(
  store: TraceStore,
  file: File,
): Promise<LensSessionFile> {
  const text = await file.text();
  const session = parseSessionFile(text);
  importSession(store, session);
  await saveSessionToIdb(session).catch(() => {
    /* ignore */
  });
  return session;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
  });
}

interface StoredSession extends SessionListEntry {
  file: LensSessionFile;
}

function toEntry(id: string, session: LensSessionFile, byteSize: number): SessionListEntry {
  const title = session.meta?.title ?? `Session ${new Date(session.exportedAt).toLocaleString()}`;
  return {
    id,
    title,
    exportedAt: session.exportedAt,
    updatedAt: new Date().toISOString(),
    protocolVersion: session.protocolVersion,
    eventCount: session.payload.events.length,
    snapshotCount: session.payload.snapshots.length,
    instanceCount: session.payload.instances.length,
    byteSize,
    ...(session.meta?.pageUrl ? { pageUrl: session.meta.pageUrl } : {}),
  };
}

export async function saveSessionToIdb(session: LensSessionFile): Promise<SessionListEntry> {
  const db = await openDb();
  const id = crypto.randomUUID();
  const body = JSON.stringify(session);
  const entry = toEntry(id, session, body.length);
  const record: StoredSession = { ...entry, file: session };

  await idbPut(db, record);
  await pruneOld(db);
  db.close();
  return entry;
}

export async function listRecentSessions(): Promise<SessionListEntry[]> {
  try {
    const db = await openDb();
    const all = await idbGetAll(db);
    db.close();
    return all
      .map(({ file: _f, ...meta }) => meta)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export async function loadSessionFromIdb(id: string): Promise<LensSessionFile | null> {
  try {
    const db = await openDb();
    const record = await idbGet(db, id);
    db.close();
    if (!record) return null;
    // Touch updatedAt
    record.updatedAt = new Date().toISOString();
    const db2 = await openDb();
    await idbPut(db2, record);
    db2.close();
    return record.file;
  } catch {
    return null;
  }
}

export async function deleteSessionFromIdb(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function pruneOld(db: IDBDatabase): Promise<void> {
  const all = await idbGetAll(db);
  if (all.length <= MAX_RECENT) return;
  const sorted = [...all].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const drop = sorted.slice(0, all.length - MAX_RECENT);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const r of drop) store.delete(r.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbPut(db: IDBDatabase, record: StoredSession): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbGet(db: IDBDatabase, id: string): Promise<StoredSession | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as StoredSession | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(db: IDBDatabase): Promise<StoredSession[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as StoredSession[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}
