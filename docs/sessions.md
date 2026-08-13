# Sessions

A **session** is a portable snapshot of the React Lens event log — everything
the panel, CLI, and MCP need to answer questions offline.

## Export / import

From the panel (⌘K): export the current trace as `.json`, or import a file to
reload. Recent sessions also persist in IndexedDB (capped) and reload from ⌘K.

## File shape (v1)

```ts
interface LensSessionFile {
  protocolVersion: number; // currently 1
  exportedAt: string; // ISO timestamp
  payload: {/* events, snapshots, instances, … */};
  meta?: {
    title?: string;
    pageUrl?: string;
    redacted?: boolean; // reserved; panel export does not set this today
  };
}
```

JSON Schema: [`packages/protocol/schemas/session.v1.json`](../packages/protocol/schemas/session.v1.json).
Only **protocolVersion 1** is supported today (`parseSessionFile` /
`loadSession` in `@reactlens/protocol`).

## Sensitivity

Session files can contain serialized props, state, and DOM from the inspected
app. Treat them like production logs:

- Do not commit sessions with secrets to public repos.
- MCP string previews stay redacted unless you pass `--include-values`
  (tool output only — the session file itself is unchanged).

## Downstream

| Consumer        | Command / API                                                              |
| --------------- | -------------------------------------------------------------------------- |
| Markdown report | `react-lens analyze session.json`                                          |
| MCP agent       | `react-lens mcp --session session.json`                                    |
| CI              | `react-lens ci --baseline … --actual …`                                    |
| Programmatic    | `compareSessions(beforePayload, afterPayload)` in `@reactlens/agent-tools` |

See [cli.md](cli.md), [mcp.md](mcp.md), [verify.md](verify.md).
