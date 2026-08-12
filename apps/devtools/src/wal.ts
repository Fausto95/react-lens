import type { EventsBatchMessage } from "@reactlens/protocol";

/**
 * Write-ahead log for ingested frames.
 *
 * The trace store lives in memory, so closing DevTools, reloading the panel or
 * crashing it threw the whole session away — the plainest way this tool can
 * lose traces. Every frame is appended here as it is ingested, and the panel
 * resumes from the log on boot.
 *
 * It is also what makes the page-side ack honest: the content script may forget
 * its copy of a frame only once *this* has it, not merely once the store has
 * rendered it. A failed write therefore has to be reported, not swallowed —
 * `onFailed` is how the panel holds its cursor so the page re-delivers.
 *
 * Storage is injected: the core (batching, budget, recovery) is provable
 * without IndexedDB, and moving the log into a worker changes nothing here.
 */

type Payload = EventsBatchMessage["payload"];

/**
 * One durable write: frames and the exact seqs they are, in step.
 *
 * The seqs are listed rather than summarised by a high-water mark because the
 * run has holes: a frame whose ingest threw is never appended, and a
 * "everything through N is durable" claim would quietly cover it.
 */
export interface WalRecord {
  sessionId: string;
  seqs: number[];
  frames: Payload[];
}

export interface WalStore {
  put(id: number, record: WalRecord): Promise<void>;
  all(): Promise<Array<{ id: number; record: WalRecord }>>;
  delete(ids: readonly number[]): Promise<void>;
  clear(): Promise<void>;
}

/** Trailing window for batching appends into one write. */
export const WAL_FLUSH_MS = 250;
/** Frames retained. Beyond this the oldest records go, and it is reported. */
const DEFAULT_MAX_FRAMES = 20_000;

export interface TraceWalOptions {
  /** These seqs of `sessionId` are on disk. */
  onDurable?: (sessionId: string, seqs: readonly number[]) => void;
  /** This write never landed; the caller must not treat these as kept. */
  onFailed?: (sessionId: string, seqs: readonly number[]) => void;
  /** The budget forced `count` frames out of the log. */
  onDropped?: (count: number) => void;
  maxFrames?: number;
  flushMs?: number;
}

export interface RecoveredSession {
  sessionId: string;
  lastSeq: number;
  frames: Payload[];
}

export interface TraceWal {
  /** Queue a frame. Durability is reported through `onDurable`. */
  append(sessionId: string, seq: number, frame: Payload): void;
  /** Write anything queued and settle outstanding work. */
  flush(): Promise<void>;
  /** The newest session in the log, ready to ingest. Sweeps older ones. */
  recover(): Promise<RecoveredSession | null>;
  close(): void;
}

export function createTraceWal(store: WalStore, opts: TraceWalOptions = {}): TraceWal {
  const flushMs = opts.flushMs ?? WAL_FLUSH_MS;
  const maxFrames = opts.maxFrames ?? DEFAULT_MAX_FRAMES;
  let queue: Payload[] = [];
  let queueSeqs: number[] = [];
  let queueSession: string | null = null;
  let nextId = 1;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let work: Promise<unknown> = Promise.resolve();
  let closed = false;
  /** Frames per written record, so the budget needs no re-read. */
  const written: Array<{ id: number; frames: number }> = [];
  let writtenFrames = 0;

  function track(next: () => Promise<unknown>): void {
    work = work.then(next).catch(() => undefined);
  }

  function schedule(): void {
    if (timer !== null || closed) return;
    timer = setTimeout(() => {
      timer = null;
      writeQueue();
    }, flushMs);
  }

  function writeQueue(): void {
    if (queue.length === 0 || queueSession === null) return;
    const record: WalRecord = { sessionId: queueSession, seqs: queueSeqs, frames: queue };
    const id = nextId++;
    queue = [];
    queueSeqs = [];
    track(async () => {
      try {
        await store.put(id, record);
      } catch {
        // Quota, a closed connection, a private-mode block. The frames are not
        // durable, so say so: the caller holds its cursor and the page keeps
        // its copy until a later write succeeds.
        opts.onFailed?.(record.sessionId, record.seqs);
        return;
      }
      written.push({ id, frames: record.frames.length });
      writtenFrames += record.frames.length;
      opts.onDurable?.(record.sessionId, record.seqs);
      await enforceBudget();
    });
  }

  /** Drop whole records from the front until the log fits. */
  async function enforceBudget(): Promise<void> {
    if (writtenFrames <= maxFrames) return;
    const doomed: number[] = [];
    let freed = 0;
    while (written.length > 1 && writtenFrames - freed > maxFrames) {
      const oldest = written.shift()!;
      doomed.push(oldest.id);
      freed += oldest.frames;
    }
    if (doomed.length === 0) return;
    writtenFrames -= freed;
    await store.delete(doomed);
    opts.onDropped?.(freed);
  }

  function resetFor(sessionId: string): void {
    queueSession = sessionId;
    queue = [];
    queueSeqs = [];
    written.length = 0;
    writtenFrames = 0;
    // A reloaded page restarts every id factory, so the old log can neither be
    // replayed into this session nor recovered into it.
    track(() => store.clear());
  }

  return {
    append(sessionId, seq, frame) {
      if (closed) return;
      if (sessionId !== queueSession) resetFor(sessionId);
      queue.push(frame);
      queueSeqs.push(seq);
      schedule();
    },

    async flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      writeQueue();
      await work;
    },

    async recover() {
      const all = await store.all();
      if (all.length === 0) return null;
      // Highest id wins: a crash between a session reset and its first write
      // can leave an older document's records behind.
      const newest = all[all.length - 1]!.record.sessionId;
      const mine = all.filter((r) => r.record.sessionId === newest);
      const stale = all.filter((r) => r.record.sessionId !== newest).map((r) => r.id);
      if (stale.length > 0) await store.delete(stale);

      const frames = mine.flatMap((r) => r.record.frames);
      if (frames.length === 0) return null;
      // Resume appending after what is already on disk.
      nextId = all[all.length - 1]!.id + 1;
      queueSession = newest;
      written.length = 0;
      writtenFrames = 0;
      for (const r of mine) {
        written.push({ id: r.id, frames: r.record.frames.length });
        writtenFrames += r.record.frames.length;
      }
      return {
        sessionId: newest,
        lastSeq: Math.max(...mine.flatMap((r) => r.record.seqs)),
        frames,
      };
    },

    close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      queue = [];
    },
  };
}
