import { PROTOCOL_VERSION, type EventsBatchMessage } from "./message.js";

/** On-disk session format — TraceStore export plus protocol version. */
export interface LensSessionFile {
  protocolVersion: number;
  exportedAt: string;
  payload: EventsBatchMessage["payload"];
  meta?: {
    title?: string;
    pageUrl?: string;
    redacted?: boolean;
  };
}

export function parseSessionFile(raw: string): LensSessionFile {
  const data = JSON.parse(raw) as unknown;
  if (!data || typeof data !== "object") {
    throw new Error("Invalid React Lens session file: not an object");
  }
  const file = data as LensSessionFile;
  if (typeof file.protocolVersion !== "number") {
    throw new Error("Invalid React Lens session file: missing protocolVersion");
  }
  if (!file.payload || !Array.isArray(file.payload.events)) {
    throw new Error("Invalid React Lens session file: missing payload.events");
  }
  return file;
}

/** Version adapters — v1 is identity. */
export function loadSession(raw: string): LensSessionFile {
  const file = parseSessionFile(raw);
  switch (file.protocolVersion) {
    case 1:
      return file;
    default:
      throw new Error(
        `Unsupported session protocol version ${file.protocolVersion} (expected ${PROTOCOL_VERSION})`,
      );
  }
}

/** Build a session file from a TraceStore export payload. */
export function exportSessionPayload(
  storeExport: EventsBatchMessage["payload"],
  meta?: LensSessionFile["meta"],
): LensSessionFile {
  return {
    protocolVersion: PROTOCOL_VERSION,
    exportedAt: new Date().toISOString(),
    payload: storeExport,
    ...(meta ? { meta } : {}),
  };
}
