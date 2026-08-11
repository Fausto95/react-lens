/**
 * The wire representation of application data. We never send live references
 * or the app's object graph — only these structured snapshots. `identity` is a
 * stable string minted per underlying reference within a session; two snapshots
 * sharing an identity are the same reference. This is the entire basis of
 * reference-vs-value diffing.
 */
export type SerializedValue =
  | { k: "primitive"; type: "string" | "number" | "boolean"; value: string | number | boolean }
  | { k: "null" }
  | { k: "undefined" }
  | { k: "bigint"; value: string }
  | { k: "symbol"; description?: string; identity: string }
  | { k: "function"; identity: string; name?: string }
  | { k: "date"; iso: string }
  | { k: "regexp"; source: string; flags: string }
  | { k: "array"; identity: string; length: number; items?: SerializedValue[] }
  | { k: "object"; identity: string; ctor?: string; entries?: Array<[string, SerializedValue]> }
  | {
      k: "map";
      identity: string;
      size: number;
      entries?: Array<[SerializedValue, SerializedValue]>;
    }
  | { k: "set"; identity: string; size: number; values?: SerializedValue[] }
  | { k: "dom"; identity: string; nodeName: string }
  | { k: "react-element"; identity: string; typeName?: string }
  | { k: "ref"; identity: string }
  | { k: "unserializable"; reason: string };

/** True when the value carries a stable reference identity. */
export function hasIdentity(
  v: SerializedValue,
): v is Extract<SerializedValue, { identity: string }> {
  return "identity" in v && typeof v.identity === "string";
}
