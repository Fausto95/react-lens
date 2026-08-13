# CLI

```bash
pnpm react-lens <command>
# or, from a package that depends on @reactlens/cli once published:
# react-lens <command>
```

Today the entry in this repo is:

```bash
pnpm react-lens
# → node --import tsx packages/cli/src/cli.ts
```

## `analyze`

Turn a session file into a markdown report (summary, waste, slowness).

```bash
pnpm react-lens analyze path/to/session.json
```

Writes the report to stdout. Export a session from the panel first
([sessions.md](sessions.md)).

## `mcp`

Start the stdio MCP server over a session file. See [mcp.md](mcp.md).

```bash
pnpm react-lens mcp --session path/to/session.json
# or
LENS_SESSION=path/to/session.json pnpm react-lens mcp
```

| Flag / env         | Meaning                                               |
| ------------------ | ----------------------------------------------------- |
| `--session <file>` | Session JSON path                                     |
| `LENS_SESSION`     | Same, when `--session` is omitted                     |
| `--include-values` | Opt in to unredacted string previews (off by default) |

## `ci`

Compare **baseline** vs **actual** session directories for interaction
regressions. Exit code `1` when checks fail.

```bash
pnpm react-lens ci --baseline ./baselines --actual ./actual
```

Update baselines after an intentional change:

```bash
pnpm react-lens ci --update-baseline --baseline ./baselines --actual ./actual
```

| Flag                | Meaning                                     |
| ------------------- | ------------------------------------------- |
| `--baseline <dir>`  | Directory of baseline session files         |
| `--actual <dir>`    | Directory of freshly captured sessions      |
| `--update-baseline` | Copy actual → baseline instead of comparing |

Pair with named interactions from [@reactlens/playwright](verify.md). CI pairs
files by **filename** inside `--baseline` / `--actual`; within a pair,
`compareSessions` keys deltas by interaction label.

## Related

- Package contracts: [INTERFACES.md](../INTERFACES.md) (`@reactlens/cli`)
- MCP playbook: [packages/mcp/AGENTS.md](../packages/mcp/AGENTS.md)
