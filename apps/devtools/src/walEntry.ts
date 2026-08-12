/**
 * The write-ahead log as the extension shell consumes it: the panel host owns
 * the port and the cursor, so it is the only place that can decide a frame is
 * durable. Kept off the panel entry so the log stays independent of the UI.
 */
export {
  createTraceWal,
  WAL_FLUSH_MS,
  type TraceWal,
  type TraceWalOptions,
  type RecoveredSession,
  type WalRecord,
  type WalStore,
} from "./wal.js";
export { createIdbWalStore } from "./walIdb.js";
