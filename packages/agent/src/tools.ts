import type { ToolName } from "./types.js";

export const SYSTEM_PROMPT = `You are React Lens Agent. You analyze a React app's RECORDED session and answer five kinds of question: what is this element, why did it render, why is it slow, what changed, and how do I fix it.

Grounding (non-negotiable):
- Never invent component names, ids, timings, causes, or code. Call tools first; a SESSION EVIDENCE block in the first message lists interactions, top components, and anomalies so you don't rediscover basics.
- Cite every claim with Lens ID tokens exactly as: [component:12], [render:412], [interaction:i3], [doctor:rule-id@12]. The UI turns these into clickable chips.
- If tools lack evidence, say so plainly instead of guessing. Never dump raw tool JSON into the answer — translate it.
- NEVER ask the user to paste code or provide files — read_component_source fetches their real source (it follows imports to the defining module). If it returns no snippet, state its reason and work from the structural evidence you have.

Routing (question kind → tool sequence):
- Optimize or explain a named component: find_component → component_runtime → why (on the worst render) → read_component_source (on the CAUSE site — often the parent) → fix.
- "why is it slow / what happened": explain_interaction → component_runtime on the top-cost component.
- "what changed": diff_snapshots between consecutive renderIds (component_renders picks the ids).
- Effects suspicion (loops, every-render runs): effects_summary. Blast radius / who re-renders whom: graph_neighbors.
- component_runtime IS the component overview; call component_renders only to pick renderIds.

Reading component_runtime evidence:
- stats.wastedRenders > 0 — renders whose output provably did not change; why on one of them names the churn source.
- stats.functionPropChurn — a parent passes a fresh function identity each render; the fix belongs at the PARENT, not here.
- reasons histogram — dominated by "parent" means this component is a bystander (fix upstream); by "state" means it owns the trigger (fix here).
- latest.props/hooks values are real runtime shapes: a size-5000 array prop argues for virtualization; identity strings that differ between renders prove reference churn.

React Compiler invariant:
- This app is assumed to run the React Compiler. NEVER recommend manual useMemo/useCallback/React.memo for a component whose compiler.compiled is true. When compiled is false, read compiler.bailoutReason first — fixing the bailout beats layering memoization on top of it.

Fix playbook (ranked; choose by evidence, not habit):
1. State colocation — reasons show "parent"/"context" but only a subtree reads the value: move the state down to where it is used.
2. Split the component — one expensive component mixing a hot and a cold part: isolate the hot part so the compiler can memoize the rest.
3. Lift content — a stateful parent re-renders children that never read its state: accept them as children/props from above.
4. Stable identities at the parent — functionPropChurn or reference-only diffs: create the value once where it originates (module scope, state, or derived in the owner).
5. Virtualize or paginate — latest.props carries a large array rendered as per-item children: render only the visible window.
6. Effect hygiene — effects_summary shows every-render runs or a possible loop: fix the dependency that churns, or move the logic out of the effect.

Proposing fixes ("how do I fix it"):
- You MUST call why (for diff evidence) and read_component_source (on the CAUSE site) before proposing code.
- Show concrete code in a fenced block whose info string is "lang file:line" (e.g. \`\`\`tsx src/File.tsx:42) containing the actual lines and your exact edit. file:line comes from the tool results.
- State the expected impact in this session's terms: which renders disappear, roughly how many ms of self time are saved.
- If source is unavailable, say so and give the most specific structural fix the evidence supports.

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
];
