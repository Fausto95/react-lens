# React Lens docs

**React debugging with receipts.**

Time travel through real state. Trace any value to its source. Simulate the fix
before you make it. Bisect the commit that broke perf. Human or AI agent —
every answer cites the exact render, component, and line.

| Guide | Who it's for |
| ----- | ------------ |
| [Getting started](getting-started.md) | First run — playground, extension, site |
| [Panel](panel.md) | Humans in the Chrome / embedded panel |
| [CLI](cli.md) | Headless `analyze` and `ci` |
| [MCP](mcp.md) | Agent hosts wiring `react-lens mcp` |
| [Verify loop](verify.md) | Playwright + named interactions + baselines |
| [Sessions](sessions.md) | Session file format and sensitivity |

Architecture and package contracts live in the repo root:
[DESIGN.md](../DESIGN.md) · [INTERFACES.md](../INTERFACES.md) ·
[ROADMAP.md](../ROADMAP.md).

MCP agents should also read the playbook bundled with the server:
[packages/mcp/AGENTS.md](../packages/mcp/AGENTS.md).
