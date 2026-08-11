import type { SerializedValue } from "@reactlens/protocol";

/**
 * Compact, depth-limited digest of a SerializedValue for agent tool results.
 * The agent needs runtime *shape* evidence (array sizes, key sets, identity
 * churn), not a full value dump — caps keep any summary inside the per-result
 * budget (budget.ts) so results never truncate mid-JSON.
 */
export interface ValueSummary {
  type: string;
  /** Short human rendering: "42", "ƒ onSelect", a string preview, "<Card>". */
  preview?: string;
  /** True size: array length, map/set size, object key count, string length. */
  size?: number;
  /** Array items within the depth limit, capped at MAX_ITEMS. */
  items?: ValueSummary[];
  /** Object entries within the depth limit, capped at MAX_KEYS. */
  entries?: Record<string, ValueSummary>;
  /** Some content was cut by a cap (items, keys, preview, or depth). */
  truncated?: boolean;
  /** Stable per-reference identity — same string means same reference. */
  identity?: string;
}

const STRING_PREVIEW = 80;
const MAX_ITEMS = 5;
const MAX_KEYS = 12;
const MAX_DEPTH = 2;

export function summarizeValue(v: SerializedValue, depth: number = MAX_DEPTH): ValueSummary {
  switch (v.k) {
    case "primitive": {
      if (v.type === "string") {
        const s = String(v.value);
        if (s.length <= STRING_PREVIEW) return { type: "string", preview: s };
        return {
          type: "string",
          preview: `${s.slice(0, STRING_PREVIEW)}…`,
          size: s.length,
          truncated: true,
        };
      }
      return { type: v.type, preview: String(v.value) };
    }
    case "null":
      return { type: "null" };
    case "undefined":
      return { type: "undefined" };
    case "bigint":
      return { type: "bigint", preview: v.value };
    case "symbol":
      return { type: "symbol", ...(v.description ? { preview: v.description } : {}), identity: v.identity };
    case "function":
      return { type: "function", preview: `ƒ ${v.name ?? "anonymous"}`, identity: v.identity };
    case "date":
      return { type: "date", preview: v.iso };
    case "regexp":
      return { type: "regexp", preview: `/${v.source}/${v.flags}` };
    case "array": {
      const out: ValueSummary = { type: "array", size: v.length, identity: v.identity };
      if (v.items && v.items.length > 0) {
        if (depth <= 0) return { ...out, truncated: true };
        out.items = v.items.slice(0, MAX_ITEMS).map((item) => summarizeValue(item, depth - 1));
        if (v.length > MAX_ITEMS) out.truncated = true;
      }
      return out;
    }
    case "object": {
      const out: ValueSummary = { type: "object", identity: v.identity };
      if (v.ctor && v.ctor !== "Object") out.preview = v.ctor;
      if (v.entries) {
        out.size = v.entries.length;
        if (depth <= 0) return v.entries.length > 0 ? { ...out, truncated: true } : out;
        const entries: Record<string, ValueSummary> = {};
        for (const [key, value] of v.entries.slice(0, MAX_KEYS)) {
          entries[key] = summarizeValue(value, depth - 1);
        }
        out.entries = entries;
        if (v.entries.length > MAX_KEYS) out.truncated = true;
      }
      return out;
    }
    case "map":
      return { type: "map", size: v.size, identity: v.identity };
    case "set":
      return { type: "set", size: v.size, identity: v.identity };
    case "dom":
      return { type: "dom", preview: `<${v.nodeName.toLowerCase()}>`, identity: v.identity };
    case "react-element":
      return {
        type: "react-element",
        preview: `<${v.typeName ?? "Element"}>`,
        identity: v.identity,
      };
    case "ref":
      return { type: "ref", identity: v.identity };
    case "unserializable":
      return { type: "opaque", preview: v.reason };
    default:
      return { type: "opaque" };
  }
}
