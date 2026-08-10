import type { ToolName } from "./types.js";

export const SYSTEM_PROMPT = `You are React Lens Agent. You answer questions about a React app's recorded session using ONLY the provided tools (TRACE / GRAPH / DIFF / Doctor / Explain / Source).

Rules:
- Never invent component names, timings, or causes. Call tools first.
- Every claim must cite Lens IDs returned by tools (interaction id, component id, render id, doctor ruleId).
- Prefer explain_interaction for "what happened / why janky" questions.
- Be concise. End with a short ranked next step.
- If tools lack evidence, say so.`;

export const TOOL_DEFINITIONS: Array<{
  type: "function";
  function: {
    name: ToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
}> = [
  {
    type: "function",
    function: {
      name: "explain_interaction",
      description: "Deterministic ranked narrative for an interaction (cost, waste, cause chain, doctor, next click).",
      parameters: {
        type: "object",
        properties: {
          interactionId: { type: "string", description: "Interaction id; omit for the latest." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_trace",
      description: "Session stats and top renders for an interaction.",
      parameters: {
        type: "object",
        properties: {
          interactionId: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "why",
      description: "Why a specific render happened (causes + verdict).",
      parameters: {
        type: "object",
        required: ["renderId"],
        properties: { renderId: { type: "number" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "root_cause",
      description: "Top cause for a render.",
      parameters: {
        type: "object",
        required: ["renderId"],
        properties: { renderId: { type: "number" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diff_snapshots",
      description: "Diff props/dom/state/hooks/context between two renders.",
      parameters: {
        type: "object",
        required: ["kind", "beforeRenderId", "afterRenderId"],
        properties: {
          kind: { type: "string", enum: ["props", "dom", "state", "hooks", "context"] },
          beforeRenderId: { type: "number" },
          afterRenderId: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diagnose",
      description: "Doctor diagnostics for one component.",
      parameters: {
        type: "object",
        required: ["componentId"],
        properties: { componentId: { type: "number" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resolve_source",
      description: "Map a compiled source location to the original file/line.",
      parameters: {
        type: "object",
        required: ["file", "line", "column"],
        properties: {
          file: { type: "string" },
          line: { type: "number" },
          column: { type: "number" },
        },
      },
    },
  },
];
