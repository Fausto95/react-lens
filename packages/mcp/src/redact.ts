/** Redact string previews in tool results unless host opts into --include-values. */
export function redactToolResult(value: unknown): unknown {
  return redactNode(value);
}

function redactNode(value: unknown): unknown {
  if (value == null || typeof value !== "object") {
    if (typeof value === "string" && value.length > 80) {
      return `${value.slice(0, 40)}…[redacted]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactNode);
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "preview" && typeof v === "string") {
      out[k] = "[redacted preview]";
    } else if (k === "snippet" && typeof v === "string") {
      out[k] = v.split("\n").slice(0, 8).join("\n") + "\n…[truncated]";
    } else if (k === "value" && typeof v === "string" && v.length > 60) {
      out[k] = "[redacted]";
    } else {
      out[k] = redactNode(v);
    }
  }
  return out;
}
