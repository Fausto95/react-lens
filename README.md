<p align="center">
  <img src="apps/site/public/og.png" alt="React Lens — see every render, follow every cause" width="800" />
</p>

<h1 align="center">React Lens</h1>

<p align="center">
  <strong>See every render. Follow every cause.</strong><br />
  Time-travel through real React state, inspect interactions on a professional timeline,
  and trace render cascades from the event that started them to the components that paid the cost.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-a78bfa" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/React-19%20%2B%20Compiler-a78bfa" alt="React 19 + Compiler" />
  <img src="https://img.shields.io/badge/TypeScript-strict-a78bfa" alt="TypeScript strict" />
</p>

---

React Lens is a React debugging workspace built around one idea: **debug from evidence, not guesses**.
Every interaction, commit, render, cause, diff, and diagnostic lands in one trace that humans, AI agents,
the CLI, MCP clients, and CI can all query.

## What makes it different

- **Time travel through real React state** — scrub the playhead and, in development builds, restore captured `useState`, `useReducer`, and class state through React's own override API.
- **Cascade** — turn an interaction into a causal render graph. Follow upstream/downstream paths, inspect fanout, focus expensive work or roots, pan/zoom/fit, and keep large graphs navigable with a minimap.
- **Professional interaction timeline** — a zoomable, scrollable editing-style timeline for interactions, commits, component work, ordering, and time-travel playback.
- **Render causes** — ranked explanations for props, state, hooks, context, parent renders, mounts, and avoidable work, with confidence and diff evidence.
- **Per-render and A/B diffs** — inspect what one render changed, or compare two commits for a whole-app index of what ended up different.
- **Bidirectional selection** — pick an element on the page and jump to its component; select a component in Lens and highlight/scroll the real DOM target.
- **Inspector** — props, state, hooks, DOM, source, and development-only live editing through the renderer.
- **Waste detection** — flag renders that produced no visible change and jump straight to the worst offender.
- **AST Doctor** — fuse static source analysis with runtime evidence and stamp findings with `file:line`.
- **Effect debugger** — effect run/cleanup timing plus possible-loop detection.
- **Suspense, RSC, and Compiler awareness** — surface boundaries, server roles/actions, compiled components, and compiler bailouts as first-class evidence.
- **Sessions** — export/import portable trace JSON and keep recent sessions in IndexedDB.
- **AI agent, BYOK** — ⌘I opens an in-panel assistant using OpenAI, Anthropic, or Z.AI. Your key stays in the browser and answers cite clickable Lens IDs.

## Agents, CLI, MCP, and CI

React Lens exposes the same trace-grounded model outside the panel:

```bash
pnpm react-lens analyze path/to/session.json
pnpm react-lens mcp --session path/to/session.json
pnpm react-lens ci --baseline ./baselines --actual ./actual
```

- `react-lens analyze` turns a session into a Markdown report.
- `react-lens mcp` exposes typed tools over stdio for Cursor, Claude, and other MCP hosts.
- `react-lens ci` compares matching baseline/actual sessions for regressions.
- Playwright helpers let tests name interactions, export sessions, and verify before/after behavior.

See [docs/cli.md](docs/cli.md), [docs/mcp.md](docs/mcp.md), [docs/verify.md](docs/verify.md), and [docs/sessions.md](docs/sessions.md).

## Quick start

Requires Node ≥ 20 and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev:playground
```

The playground needs no extension: interact with the demo app and the embedded React Lens panel records the trace.

### Chrome extension

```bash
pnpm build:extension
```

Load `apps/extension/dist` as an unpacked extension, then open DevTools → **React Lens**.

### Product site

```bash
pnpm dev:site
```

The site is also a live demo: it inspects its own React tree while you use it.

Full walkthrough: [docs/getting-started.md](docs/getting-started.md). Live site: [reactlens.xyz](https://www.reactlens.xyz/).

## How it works

A pure analysis core sits behind a small page-side capture layer. The panel, CLI, MCP server, and CI are consumers of the same event log rather than separate debugging implementations.

```text
packages/
  protocol/         shared events, messages, sessions
  serializer/       safe value serialization
  diff-engine/      value + DOM diffing
  trace-engine/     event log, queries, subscriptions
  causality/        why-did-this-render + verdicts
  fiber/            React ownership + DOM ↔ fiber resolution
  instrumentation/  commits + interactions → events
  diagnostics/      runtime + static Doctor rules
  explain/          deterministic interaction narratives
  agent/            trace-grounded BYOK tool loop
  agent-tools/      shared panel / CLI / MCP handlers
  cli/              analyze · mcp · ci
  mcp/              stdio MCP server
  playwright/       named-interaction verification helpers
  source-maps/      runtime component ↔ original source
  tree/ graph/      semantic projections
  ui/ icons/        shared primitives
apps/
  devtools/         React Lens panel, timeline, Cascade, inspector
  playground/       demo app engineered to misbehave
  extension/        MV3 Chrome extension shell
  site/             product site that inspects itself
  e2e-fixture/      Playwright / CI fixture
```

Architecture: [DESIGN.md](DESIGN.md). Package contracts: [INTERFACES.md](INTERFACES.md). Roadmap: [ROADMAP.md](ROADMAP.md).

## Status

The core is demoable end-to-end: React capture, semantic tree, inspector, interaction timeline, real-state time travel, Cascade, render causes, Doctor, waste detection, AI agent, sessions, CLI/MCP, CI verification, and the Chrome extension shell.

Not yet: npm-published packages, Firefox/Safari extensions, and network adapters.

## Contributing

Issues and PRs are welcome.

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm dev:playground
```

Keep the analysis core pure, match the existing TypeScript/UI patterns, and prefer tests around behavior and contracts.

## License

[MIT](LICENSE)
