import type { LensRef } from "@reactlens/explain";
import type { ToolCall, ToolHandlers, ToolName } from "./types.js";
import { TOOL_BUDGETS } from "./tools.js";
import { TOOL_SCHEMA_VERSION } from "./types.js";

type FieldSpec = {
  type: "string" | "number" | "object";
  required?: boolean;
  enum?: readonly string[];
};

export const TOOL_ARG_SPECS: Record<ToolName, Record<string, FieldSpec>> = {
  explain_interaction: { interactionId: { type: "string" } },
  query_trace: { interactionId: { type: "string" }, limit: { type: "number" } },
  why: { renderId: { type: "number", required: true } },
  diff_snapshots: {
    kind: { type: "string", required: true, enum: ["props", "dom", "state", "hooks", "context"] },
    beforeRenderId: { type: "number", required: true },
    afterRenderId: { type: "number", required: true },
  },
  diagnose: { componentId: { type: "number", required: true } },
  resolve_source: {
    file: { type: "string", required: true },
    line: { type: "number", required: true },
    column: { type: "number", required: true },
  },
  find_component: { name: { type: "string", required: true } },
  component_renders: { componentId: { type: "number", required: true }, limit: { type: "number" } },
  component_runtime: { componentId: { type: "number", required: true } },
  read_component_source: {
    componentId: { type: "number", required: true },
    contextLines: { type: "number" },
  },
  effects_summary: { componentId: { type: "number", required: true } },
  graph_neighbors: { componentId: { type: "number", required: true } },
  list_interactions: { limit: { type: "number" } },
  get_session_summary: {},
  list_components: { name: { type: "string" }, limit: { type: "number" } },
  get_waste_report: { limit: { type: "number" } },
  diff_commits: {
    beforeCommitId: { type: "number", required: true },
    afterCommitId: { type: "number", required: true },
  },
  query_events: {
    type: { type: "string" },
    componentId: { type: "number" },
    interactionId: { type: "string" },
    cursor: { type: "string" },
    limit: { type: "number" },
  },
  get_source_location: { lensId: { type: "string", required: true } },
  diagnose_slowness: { interactionId: { type: "string" } },
  find_wasted_renders: { limit: { type: "number" } },
  why_did_component_render: { componentId: { type: "number", required: true } },
  compare_sessions: {
    before: { type: "object", required: true },
    after: { type: "object", required: true },
  },
};

export function parseToolArgs(
  call: ToolCall,
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  const spec = TOOL_ARG_SPECS[call.name];
  if (!spec) return { ok: false, error: `unknown tool ${call.name}` };
  const out: Record<string, unknown> = {};
  for (const [field, rule] of Object.entries(spec)) {
    const raw = call.arguments[field];
    const value =
      rule.type === "number" &&
      typeof raw === "string" &&
      raw.trim() !== "" &&
      Number.isFinite(Number(raw))
        ? Number(raw)
        : raw;
    if (value === undefined || value === null) {
      if (rule.required) {
        return { ok: false, error: `${call.name}: missing required argument "${field}"` };
      }
      continue;
    }
    if (rule.type === "object") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { ok: false, error: `${call.name}: argument "${field}" must be an object` };
      }
    } else if (typeof value !== rule.type) {
      return { ok: false, error: `${call.name}: argument "${field}" must be a ${rule.type}` };
    }
    if (rule.enum && !rule.enum.includes(value as string)) {
      return {
        ok: false,
        error: `${call.name}: "${field}" must be one of ${rule.enum.join(", ")}`,
      };
    }
    out[field] = value;
  }
  return { ok: true, args: out };
}

export async function executeTool(handlers: ToolHandlers, call: ToolCall): Promise<unknown> {
  const parsed = parseToolArgs(call);
  if (!parsed.ok) return { error: parsed.error, schemaVersion: TOOL_SCHEMA_VERSION };
  try {
    const handler = handlers[call.name] as (args: Record<string, unknown>) => unknown;
    const result = await handler(parsed.args);
    return enforceBudget(call.name, result);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      schemaVersion: TOOL_SCHEMA_VERSION,
    };
  }
}

/**
 * Structured budget: if JSON exceeds the tool's cap, return a summary + cursor
 * instead of slicing mid-JSON.
 */
export function enforceBudget(name: ToolName, result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const obj = result as Record<string, unknown>;
  if ("error" in obj) return { ...obj, schemaVersion: TOOL_SCHEMA_VERSION };
  const withVersion = { schemaVersion: TOOL_SCHEMA_VERSION, ...obj };
  const json = safeJson(withVersion);
  const cap = TOOL_BUDGETS[name] ?? 6_000;
  if (json.length <= cap) return withVersion;
  return {
    schemaVersion: TOOL_SCHEMA_VERSION,
    truncated: true,
    cursor: "omit-details",
    budgetNote: `${name} result exceeded ${cap} chars (${json.length}). Narrow the query (limit / specific id) or call a more specific tool.`,
    citations: Array.isArray(obj.citations) ? obj.citations : [],
  };
}

export function collectCitations(result: unknown, into: LensRef[]): void {
  if (!result || typeof result !== "object") return;
  const obj = result as Record<string, unknown>;
  if (Array.isArray(obj.citations)) {
    for (const c of obj.citations) {
      if (c && typeof c === "object" && "kind" in c) into.push(c as LensRef);
    }
  }
}

export function dedupeCitations(refs: LensRef[]): LensRef[] {
  const seen = new Set<string>();
  const out: LensRef[] = [];
  for (const r of refs) {
    const key = JSON.stringify(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "unserializable" });
  }
}
