<p align="center">
  <img src="apps/site/public/og.png" alt="React Lens — React debugging with receipts. Cascade, time travel, AI agent, render causes, Doctor, waste detection." width="800" />
</p>

<h1 align="center">React Lens</h1>

<p align="center">
  <strong>React debugging with receipts.</strong><br />
  Scrub Cascade to rewind real state. Trace a render to its cause. Preview waste
  before you change code. Diff two moments — or two sessions in CI. Human or AI
  agent — every answer cites the exact render, component, and line.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-a78bfa" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/React-19%20%2B%20Compiler-a78bfa" alt="React 19 + Compiler" />
  <img src="https://img.shields.io/badge/TypeScript-strict-a78bfa" alt="TypeScript strict" />
</p>

---

Open source ([MIT](LICENSE)).

## Features

- **Cascade** — causal render graph for the selected interaction. Replay and
  time-travel controls sit on the same toolbar.
- **Time travel** — scrub or replay an interaction. In a React 19 dev build,
  that restores `useState` / `useReducer` / class state through React's
  override API. Zustand, Redux and TanStack Query rewind too, through one
  registration with [`@reactlens/adapters`](docs/stores.md). Refs, unregistered
  stores, production builds, and components that have since unmounted are not
  restored.
- **Inspector** — props, state, hooks, DOM, and source for the selection.
  Primitive `useState` values can be edited live when the renderer override
  API is present.
- **Tree** — component tree. ⌘\\ picks an element on the page; selecting in
  the panel outlines it and scrolls it into view if it is off-screen.
- **Why this render** — cause chain for a render, including a "no observable
  change" verdict when the DOM did not change.
- **Diffs** — value changes (props / state / context) for a selected render.
- **Doctor** — runtime findings on a component, plus a regex scan of its
  source when that file can be loaded.
- **Effects** — run/cleanup timings in the inspector. Marks a possible loop
  when an effect ran on nearly every recent render.
- **Sessions** — export/import the trace as JSON. Recent sessions persist in
  IndexedDB and reopen from ⌘K.
- **React Compiler** — compiled components are marked in the tree.
- **Agent (optional)** — ⌘I, bring your own OpenAI / Anthropic / Z.AI key.
  The key stays in the browser. It queries the live trace and cites Lens IDs.

From an exported session file:

- `react-lens analyze` — markdown report
- `react-lens mcp` — same tools over stdio
- `react-lens ci` — compare baseline vs actual session files (paired by name)

## Try it

Needs Node 20+ and [pnpm](https://pnpm.io).

```bash
git clone https://github.com/Fausto95/react-lens.git
cd react-lens
pnpm install
pnpm dev:playground
```

The panel is embedded in the playground — no extension required.

### Chrome extension

```bash
pnpm build:extension
```

Load `apps/extension/dist` unpacked from `chrome://extensions` (Developer mode
→ Load unpacked). Then DevTools → **React Lens**.

Firefox and Safari are not supported yet.

## Docs

[docs/](docs/) · [DESIGN.md](DESIGN.md)

## Contributing

Issues and PRs are welcome.

```bash
pnpm test
pnpm typecheck
```

Keep `trace-engine`, `diff-engine`, and `causality` free of React/DOM imports.

## License

[MIT](LICENSE)
