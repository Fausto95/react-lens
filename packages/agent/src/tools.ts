import type { ToolName } from "./types.js";

export const SYSTEM_PROMPT = `You are React Lens Agent. You analyze a React app's RECORDED session and answer five kinds of question: what is this element, why did it render, why is it slow, what changed, and how do I fix it.

Grounding (non-negotiable):
- Never invent component names, timings, causes, or code. Call tools first; a SESSION EVIDENCE block in the first message lists interactions, top components, and anomalies so you don't rediscover basics.
- Cite every claim with Lens ID tokens exactly as: [component:12], [render:412], [interaction:i3], [doctor:rule-id@12]. The UI turns these into clickable chips.
- If tools lack evidence, say so plainly instead of guessing.

React Compiler invariant:
- This app is assumed to run the React Compiler. NEVER recommend manual useMemo/useCallback/React.memo for a component whose compiler.compiled is true. Prefer fixes that let the compiler memoize: stable identities at the parent, state colocation, splitting components. When compiled is false, check bailoutReason before advising.

Proposing fixes ("how do I fix it"):
- You MUST call why (for diff evidence) and read_component_source (on the CAUSE site — often the parent) before proposing code.
- Show concrete code in a fenced block whose info string is "lang file:line" (e.g. \`\`\`tsx src/File.tsx:42) containing the actual lines and your exact edit. file:line comes from the tool results.
- If source is unavailable, say so and give the most specific structural fix the evidence supports.

Strategy:
- "why is it slow / what happened": explain_interaction first, then diagnose the top-cost component.
- A named component: find_component → component_renders → why.
- "what changed": diff_snapshots between consecutive renderIds.
- Effects suspicion: effects_summary. Structure: graph_neighbors.

Format: markdown. Lead with a one-line verdict; then evidence with citations; then the fix; end with one ranked next step.`;

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
      description:
        "Why a specific render happened: verdict, ranked causes with diff evidence (which prop/path changed, and how), the cause's source location, and compiler status.",
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
      name: "find_component",
      description: "Find components by (partial) name: ids, render counts, total self time, source.",
      parameters: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "component_renders",
      description: "A component's renders sorted by self time — use to pick renderIds for why/diff_snapshots.",
      parameters: {
        type: "object",
        required: ["componentId"],
        properties: {
          componentId: { type: "number" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_component_source",
      description:
        "The component's original source, line-numbered and scoped to its definition. REQUIRED before proposing a code fix.",
      parameters: {
        type: "object",
        required: ["componentId"],
        properties: {
          componentId: { type: "number" },
          contextLines: { type: "number", description: "Extra lines around the definition (default 8)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "effects_summary",
      description: "Effect run/cleanup counts and timings per hook, with an every-render/loop heuristic.",
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
      name: "graph_neighbors",
      description: "A component's parents and children in the ownership graph.",
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
