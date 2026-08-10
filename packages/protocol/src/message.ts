import type { LensEvent } from "./events.js";
import type { ComponentInstance } from "./component.js";
import type { RenderSnapshot } from "./snapshot.js";
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
  { events: LensEvent[]; snapshots: RenderSnapshot[]; instances: ComponentInstance[] }
>;

/** Panel asks the runtime for a specific snapshot on demand. */
export type SnapshotRequestMessage = LensMessage<
  "snapshot/request",
  { componentId: ComponentId; renderId: RenderId }
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
