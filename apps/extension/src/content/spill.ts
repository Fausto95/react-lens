import type { PortMessage } from "../transport.js";

/**
 * Where the durable buffer puts messages it can no longer hold in memory.
 *
 * The content script's buffer is the only copy of the session while DevTools is
 * closed, and on a real app it overflows in seconds. Dropping the overflow lost
 * minutes of history silently; `chrome.storage.local` is available to an
 * ISOLATED content script and survives everything short of a page navigation,
 * so the overflow goes there instead.
 */
export interface SpillStore {
  write(key: string, msgs: readonly PortMessage[]): Promise<void>;
  read(key: string): Promise<PortMessage[] | undefined>;
  remove(keys: readonly string[]): Promise<void>;
  /** Every key this store currently holds for us. */
  list(): Promise<readonly string[]>;
}

/** Key prefix so we only ever touch our own entries. */
export const SPILL_PREFIX = "rl-spill:";

export function spillKey(sessionId: string, loSeq: number, hiSeq: number): string {
  return `${SPILL_PREFIX}${sessionId}:${loSeq}-${hiSeq}`;
}

export interface SpillRange {
  key: string;
  sessionId: string;
  loSeq: number;
  hiSeq: number;
}

export function parseSpillKey(key: string): SpillRange | null {
  if (!key.startsWith(SPILL_PREFIX)) return null;
  const rest = key.slice(SPILL_PREFIX.length);
  const colon = rest.lastIndexOf(":");
  if (colon < 0) return null;
  const sessionId = rest.slice(0, colon);
  const [lo, hi] = rest.slice(colon + 1).split("-");
  const loSeq = Number(lo);
  const hiSeq = Number(hi);
  if (!Number.isFinite(loSeq) || !Number.isFinite(hiSeq)) return null;
  return { key, sessionId, loSeq, hiSeq };
}

/**
 * `chrome.storage.local` adapter. Returns null where the API is absent (unit
 * tests, a page context without the extension) so the buffer degrades to
 * in-memory retention rather than failing to construct.
 */
export function createChromeSpillStore(): SpillStore | null {
  const area = (globalThis as { chrome?: { storage?: { local?: chrome.storage.LocalStorageArea } } })
    .chrome?.storage?.local;
  if (!area) return null;
  return {
    async write(key, msgs) {
      await area.set({ [key]: msgs });
    },
    async read(key) {
      const got = await area.get(key);
      const value = got[key];
      return Array.isArray(value) ? (value as PortMessage[]) : undefined;
    },
    async remove(keys) {
      if (keys.length > 0) await area.remove([...keys]);
    },
    async list() {
      const all = await area.get(null);
      return Object.keys(all).filter((k) => k.startsWith(SPILL_PREFIX));
    },
  };
}
