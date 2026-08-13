import type { ToolName } from "./types.js";

/** Declared max JSON char budget per tool (structured truncation, not mid-JSON cut). */
export const TOOL_BUDGETS: Record<ToolName, number> = {
  explain_interaction: 8_000,
  query_trace: 6_000,
  why: 6_000,
  diff_snapshots: 6_000,
  diagnose: 6_000,
  resolve_source: 4_000,
  find_component: 4_000,
  component_renders: 6_000,
  component_runtime: 8_000,
  read_component_source: 10_000,
  effects_summary: 4_000,
  graph_neighbors: 4_000,
  list_interactions: 4_000,
  get_session_summary: 4_000,
  list_components: 6_000,
  get_waste_report: 6_000,
  diff_commits: 4_000,
  query_events: 4_000,
  get_source_location: 2_000,
  diagnose_slowness: 8_000,
  find_wasted_renders: 6_000,
  why_did_component_render: 8_000,
  compare_sessions: 6_000,
};

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
      description:
        "Deterministic ranked narrative for an interaction (cost, waste, cause chain, doctor, next click). Start here for 'why is it slow' / 'what just happened' questions.",
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
      description:
        "Session-wide stats and the top renders of an interaction. For one component's picture use component_runtime instead.",
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
      description:
        "Resolve a (partial) component name to ids with render counts, total self time, and source. The first call whenever the user names a component.",
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
      description:
        "A component's individual renders sorted by self time. Use ONLY to pick renderIds for why/diff_snapshots — for the component overview call component_runtime.",
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
      name: "component_runtime",
      description:
        "One-call runtime profile of a component: timings (total/avg/max self), render-reason histogram, wasted renders, compiler status, and its latest props/hooks/context values (summarized — real array sizes, key sets, function identities). Call this FIRST when asked to optimize or explain a specific component.",
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
      name: "read_component_source",
      description:
        "The component's original source, line-numbered and scoped to its definition. REQUIRED before proposing a code fix.",
      parameters: {
        type: "object",
        required: ["componentId"],
        properties: {
          componentId: { type: "number" },
          contextLines: {
            type: "number",
            description: "Extra lines around the definition (default 8).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "effects_summary",
      description:
        "Effect run/cleanup counts and timings per hook, with an every-render/loop heuristic. Use when effects are the suspect (loops, churn, slow post-commit work).",
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
      description:
        "A component's parents and children in the ownership graph — who re-renders whom, and where a parent-side fix lands.",
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
      description:
        "Diff props/dom/state/hooks/context between two renders of the same component. Needs retained snapshots — prefer recent renderIds from component_renders.",
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
      description:
        "Doctor rule findings (named anti-patterns with evidence) for one component. Corroborates a hypothesis — not a substitute for why.",
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
      description:
        "Map a compiled source location to the original file/line. Rarely needed directly — read_component_source already resolves.",
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
  {
    type: "function",
    function: {
      name: "list_interactions",
      description:
        "List interactions ranked by React cost (reactMs desc). Prefer this over query_events for navigation.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_session_summary",
      description:
        "Session digest: stats, recent interactions, top components by self time, commit anomalies, compiler coverage. Call first to orient.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_components",
      description:
        "List components (optional name filter) with render counts and total self time, ranked by cost.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Optional partial name filter." },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_waste_report",
      description:
        "Ranked no-observable-change (wasted) renders across the session. Prefer over query_events for waste hunts.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diff_commits",
      description:
        "Compare two commits: self-time delta and component-set add/remove. Read-only — does not restore page state.",
      parameters: {
        type: "object",
        required: ["beforeCommitId", "afterCommitId"],
        properties: {
          beforeCommitId: { type: "number" },
          afterCommitId: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_events",
      description:
        "LAST RESORT paginated raw event access. Prefer list_interactions / explain_interaction / get_waste_report first.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string" },
          componentId: { type: "number" },
          interactionId: { type: "string" },
          cursor: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_source_location",
      description:
        "Resolve a Lens ID (component:12, render:412, interaction:i3) to file:line when known.",
      parameters: {
        type: "object",
        required: ["lensId"],
        properties: { lensId: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diagnose_slowness",
      description:
        "Symptom tool: rank the costliest interaction, explain it, and hint next steps (why / read_component_source).",
      parameters: {
        type: "object",
        properties: { interactionId: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_wasted_renders",
      description:
        "Symptom tool: top wasted renders with next-step hints. Composes get_waste_report.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "why_did_component_render",
      description:
        "Symptom tool: runtime profile + why on the costliest retained render for a component.",
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
      name: "compare_sessions",
      description:
        "Compare before/after session payloads keyed by interaction name. Returns render and waste deltas plus a regression verdict.",
      parameters: {
        type: "object",
        required: ["before", "after"],
        properties: {
          before: {
            type: "object",
            description: "Before session payload (events/snapshots/instances).",
          },
          after: { type: "object", description: "After session payload." },
        },
      },
    },
  },
];
