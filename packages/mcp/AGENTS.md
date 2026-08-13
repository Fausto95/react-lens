# React Lens MCP Playbook

Symptoms → tool sequences for agents using React Lens session tools.

## Start here

1. `get_session_summary` — orient (stats, top components, recent interactions).
2. For slowness: `diagnose_slowness` → `explain_interaction` → `why` on top render.
3. For waste: `get_waste_report` or `find_wasted_renders` → `why` per wasted render.
4. For a named component: `find_component` → `component_runtime` → `read_component_source` before proposing fixes.

## Symptom → sequence

| Symptom | Tool sequence |
|---------|---------------|
| "Why is it slow?" | `diagnose_slowness` → `explain_interaction` → `why` |
| "Too many re-renders" | `get_waste_report` → `why` → `graph_neighbors` |
| "This component" | `find_component` → `component_runtime` → `why_did_component_render` |
| "Before vs after fix" | `compare_sessions` with before/after payloads |
| "Effect loop?" | `find_component` → `effects_summary` |

## Anti-patterns

- Do **not** call `query_events` first — use `list_interactions` / `get_session_summary`.
- Do **not** propose code fixes without `read_component_source` + `why`.
- Do **not** recommend manual `useMemo`/`memo` for React Compiler-compiled components.
- Do **not** assume string previews in tool output contain real app secrets when `redacted` is true.

## Host policy

By default, MCP hosts redact string previews in serialized values. Pass `--include-values` only when the user explicitly opts in.
