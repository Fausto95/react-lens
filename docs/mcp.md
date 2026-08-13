# MCP

`react-lens mcp` exposes the same typed tool surface the in-panel agent uses,
over a **session file** on stdio. Any MCP host (Cursor, Claude Desktop, etc.)
can diagnose React performance from an exported trace.

## Run

```bash
pnpm react-lens mcp --session path/to/session.json
```

Or set `LENS_SESSION` and omit `--session`. See [cli.md](cli.md) for flags.

### Redaction

By default the host **redacts string previews** in serialized values. Pass
`--include-values` only when the user explicitly opts in — session files can
contain app data.

## Host config (example)

Point your MCP client at the CLI entry. Exact JSON shape depends on the host;
the command is always stdio:

```bash
pnpm react-lens mcp --session /absolute/path/to/session.json
```

## Tool catalog

Twenty-two tools (same handlers as `@reactlens/agent-tools`):

| Tool | Role |
| ---- | ---- |
| `get_session_summary` | Orient — stats, top components, recent interactions |
| `list_interactions` | Named / recent interactions |
| `list_components` | Optional name filter |
| `explain_interaction` | Deterministic cost / waste / chain narrative |
| `diagnose_slowness` | Symptom entry for “why is it slow?” |
| `find_wasted_renders` / `get_waste_report` | No-observable-change renders |
| `why` / `why_did_component_render` | Cause chain for a render |
| `find_component` | Resolve a name → component id |
| `component_renders` / `component_runtime` | History and timing |
| `read_component_source` / `get_source_location` / `resolve_source` | Source before proposing fixes |
| `effects_summary` | Effect run/cleanup patterns |
| `graph_neighbors` | Ownership / causality neighbors |
| `diff_snapshots` / `diff_commits` | Value or commit diffs |
| `diagnose` | Doctor findings for a component |
| `query_trace` / `query_events` | Lower-level queries (prefer summary tools first) |
| `compare_sessions` | Before/after interaction deltas by name |

## Playbook

Symptom → tool sequences, anti-patterns, and host policy live next to the
server package:

**[packages/mcp/AGENTS.md](../packages/mcp/AGENTS.md)**

Start with `get_session_summary`. Do not propose code fixes without
`read_component_source` + `why`. Do not lead with `query_events`.

## Related

- [Sessions](sessions.md) — how to export the file
- [Verify](verify.md) — capture sessions from Playwright for CI agents
- [INTERFACES.md](../INTERFACES.md) — `@reactlens/mcp` / `agent-tools` contracts
