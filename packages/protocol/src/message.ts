import type { LensEvent } from "./events.js";
import type { ComponentInstance } from "./component.js";
import type { CommitSnapshot, RenderSnapshot } from "./snapshot.js";
import type { ComponentId, RenderId } from "./ids.js";

/** Current protocol version. Runtime and panel will drift; this gates it. */
export const PROTOCOL_VERSION = 1 as const;

export interface LensMessage<TType extends string = string, TPayload = unknown> {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: TType;
  payload: TPayload;
}

/** Handshake sent once when the runtime attaches to a page. */
export type HelloMessage = LensMessage<
  "hello",
  { runtimeVersion: string; reactVersion: string | null; tabId: number }
>;

/** The primary high-frequency channel: batched events + their snapshots. */
export type EventsBatchMessage = LensMessage<
  "events/batch",
  {
    events: LensEvent[];
    snapshots: RenderSnapshot[];
    instances: ComponentInstance[];
    /** Throttled whole-page DOM per commit (offline replay). Optional — no version bump. */
    commitSnapshots?: CommitSnapshot[];
  }
>;

/** Panel asks the runtime for a specific snapshot on demand. */
export type SnapshotRequestMessage = LensMessage<
  "snapshot/request",
  { componentId: ComponentId; renderId: RenderId }
>;

/** Panel asks the page to fetch a module / source-map URL (same-origin to the app). */
export type SourceRequestMessage = LensMessage<
  "source/request",
  { requestId: string; url: string }
>;

/** Page returns fetched source text (or an error). Body capped by the runtime. */
export type SourceResponseMessage = LensMessage<
  "source/response",
  { requestId: string; url: string; body?: string; error?: string }
>;

/** Panel toggles recording on the page. */
export type RecordControlMessage = LensMessage<"record/control", { recording: boolean }>;

/** Runtime self-reports its measured overhead (DESIGN §1.1). */
export type OverheadMessage = LensMessage<
  "overhead/report",
  { cpuPercent: number; bytesApprox: number; eventsPerSec: number }
>;

export type AnyLensMessage =
  | HelloMessage
  | EventsBatchMessage
  | SnapshotRequestMessage
  | SourceRequestMessage
  | SourceResponseMessage
  | RecordControlMessage
  | OverheadMessage;

export function isLensMessage(value: unknown): value is AnyLensMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "protocolVersion" in value &&
    (value as { protocolVersion: unknown }).protocolVersion === PROTOCOL_VERSION &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}
