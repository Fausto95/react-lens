<p align="center">
  <img src="apps/site/public/og.png" alt="React Lens — know why every render happened. Time travel, AI agent, render causes, AST Doctor, waste detection, Suspense & RSC." width="800" />
</p>

<h1 align="center">React Lens</h1>

<p align="center">
  <strong>Know why every render happened.</strong><br />
  Dev-time React observability — from interaction to cause to fix, in one panel.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-a78bfa" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/React-19%20%2B%20Compiler-a78bfa" alt="React 19 + Compiler" />
  <img src="https://img.shields.io/badge/TypeScript-strict-a78bfa" alt="TypeScript strict" />
</p>

---

React devtools tell you **what** rendered. React Lens tells you **why** — and
what it cost, whether it was wasted, and how to fix it. Every click, commit,
and render lands in one event log, so answers are backed by evidence instead
of guesses.

## The five questions

Debugging a React app is always the same five questions. Lens answers each in
one or two clicks:

1. **What is this element?** — pick it on the page (⌘\\), get the component,
   its props, state, hooks, DOM, and source.
2. **Why did it render?** — a cause chain (props / state / hooks / parent),
   with confidence levels, not a shrug.
3. **Why is it slow?** — an interaction-first timeline with commit heat and a
   component waterfall.
4. **What changed?** — value + DOM diffs per render, A/B compare any two
   commits.
5. **How do I fix it?** — Doctor findings stamped `file:line`, Explain
   narratives, and an AI agent grounded in the trace.

## Features

- **Time travel** — scrub the commit timeline and (in dev builds) restore real
  page state as you go; double-click two commits to A/B them.
- **AI agent, BYOK** — ⌘I opens an in-panel assistant (OpenAI / Anthropic /
  Z.AI; your key never leaves the browser) that answers through typed tools
  over the live trace. Every claim cites a Lens ID — clickable chips that jump
  to the exact render, component, or interaction.
- **Bidirectional selection** — click an element on the page to select it in
  the tree, or select anything in the panel to scroll the page to it and
  outline it. Off-screen components only, so walking the tree with ↑/↓ doesn't
  drag the app around.
- **Render causes** — why-did-this-render at three levels of depth, including
  a "no observable change" verdict when a render was avoidable.
- **AST Doctor** — static analysis (OXC parser, regex fallback) fused with
  runtime evidence; findings are scoped to a component's definition and
  stamped `file:line`.
- **Waste detection** — after an interaction settles, a banner flags renders
  that produced no visible change and jumps you to the worst offender.
- **Effect debugger** — timed effect run/cleanup events, durations, and a
  "possible loop" badge when an effect fires on nearly every render.
- **Suspense & RSC aware** — suspense boundaries, server-component roles, and
  server actions are detected and badged in the tree and inspector.
- **Sessions** — export/import the whole trace as a `.json` file; recent
  sessions persist in IndexedDB and reload from ⌘K.
- **Explain this interaction** — one click produces a ranked narrative: cost,
  cause chain, Doctor findings, suggested next step.
- **React 19 + Compiler aware** — compiled components are badged ◆, and Lens
  never recommends hand-rolled `useMemo` / `useCallback`.

## Quick start

Requires Node ≥ 20 and [pnpm](https://pnpm.io).

```bash
pnpm install
```

### Try it in the playground (no extension needed)

```bash
pnpm dev:playground
```

Open the page and click a product in the Shop. The in-page panel records the
interaction, flags avoidable re-renders, and can **Explain** the cost.

### Chrome extension

```bash
pnpm build:extension
```

Load `apps/extension/dist` as an unpacked extension (`chrome://extensions` →
Developer mode → Load unpacked), then open DevTools → **React Lens**.

### The site (inspects itself)

```bash
pnpm dev:site
```

The product site runs Lens on its own component tree — everything in the
panel is the page you're looking at.

## How it works

A pure analysis core — plain data in, plain data out, zero framework
dependencies — sits behind a small page-side capture half, bridged by a shared
protocol. Dependencies flow one way; the panel is just a consumer of the
event log.

```
packages/
  protocol/         shared event + message contract
  serializer/       safe value serialization (never throws)
  diff-engine/      value + DOM diff
  trace-engine/     event log, queries, subscriptions
  causality/        why-did-this-render + verdicts
  fiber/            owned React hook, DOM ↔ fiber resolution
  instrumentation/  commits + interactions → events
  diagnostics/      Doctor rules (runtime + static AST)
  explain/          deterministic interaction narratives
  agent/            trace-grounded tool loop, BYOK providers
  source-maps/      runtime component ↔ original source
  tree/ graph/      semantic tree + graph projections
  ui/ icons/        shared panel primitives
apps/
  devtools/         the React 19 panel
  playground/       demo app engineered to misbehave
  extension/        MV3 Chrome extension shell
  site/             product site (inspects itself)
```

See [DESIGN.md](DESIGN.md) for architecture decisions and
[INTERFACES.md](INTERFACES.md) for package contracts.

## Status

The core is demoable end-to-end: fiber capture, semantic tree, inspector,
timeline with time travel, Explain, Doctor, the AI agent, sessions, and the
extension shell. [ROADMAP.md](ROADMAP.md) is the living checklist of what's
built and what's next.

Not yet: npm-published packages, Firefox/Safari extensions, network adapters.

## Contributing

Issues and PRs are welcome.

```bash
pnpm install
pnpm test             # vitest across all packages
pnpm typecheck        # strict tsc -b
pnpm dev:playground   # fastest feedback loop
```

A few ground rules:

- Keep the core pure — `trace-engine` / `diff-engine` / `causality` take
  plain data and return plain data; framework coupling stays in the adapter
  layers.
- Match the existing TypeScript and UI patterns in `apps/devtools`.
- Tests first: pure logic gets plain unit tests, integration behavior gets a
  contract test against real React 19.

## License

[MIT](LICENSE)
