# React Lens

**Know why every render happened.**

Dev-time React observability — from interaction to cause to fix, in one panel.
Trace clicks, explain waste, and diff what changed over a single event log.

## Five questions, fast

1. **What is this element?**
2. **Why did it render?**
3. **Why is it slow?**
4. **What changed?**
5. **How do I fix it?**

## Features

### Timeline & time travel

Interaction-first timeline with commit heat, a component waterfall, compressed idle gaps, and a scrubbable playhead. Optional **real time travel** restores page state as you scrub (dev builds).

### Semantic tree + inspector

Ownership tree with Components / Changed / Potential Waste modes, flame bars, page highlight on hover, and a single-scroll inspector for why, props, state, hooks, DOM, source, and more.

### Explain this interaction

One click (or ⌘K) produces a ranked narrative — cost, cause chain, Doctor findings, and a suggested next step.

### Also included

- **Doctor** — runtime findings fused with static/source-aware rules
- **Waste banner** — when an interaction produces mostly no-visible-change renders
- **Sessions** — export / import / IndexedDB recent traces
- **Element picker** — inspect a component from the page (⌘\\)
- **Chrome extension** — same panel over MV3 messaging
- **React 19 + Compiler aware** — never recommends hand-rolled `useMemo` / `useCallback`

## Quick start

```bash
pnpm install
pnpm test
pnpm typecheck
```

### Playground (embedded panel, no extension)

```bash
pnpm dev:playground
```

Open the page and click a product in the Shop. The in-page panel records the interaction, flags avoidable re-renders, and can **Explain** the cost.

### Chrome extension

```bash
pnpm build:extension
```

Load `apps/extension/dist` as an unpacked extension (`chrome://extensions` → Developer mode → Load unpacked), then open DevTools → **React Lens**.

### Marketing site (live self-inspection)

```bash
pnpm dev:site
```

## Monorepo

```
packages/
  protocol/         shared event + message contract
  serializer/       safe value serialization
  diff-engine/      value + DOM diff
  trace-engine/     event log, queries, subscriptions
  causality/        why-did-this-render + verdicts
  fiber/            owned React hook, DOM ↔ fiber
  instrumentation/  commits + interactions → events
  diagnostics/      Doctor rules
  explain/          interaction narratives
  …                 source-maps, tree, graph, agent, ui, icons
apps/
  devtools/         React 19 panel
  playground/       misbehaving demo app
  extension/        MV3 Chrome extension
  site/             product site (inspects itself)
```

Design principle: a pure analysis core (`trace-engine` / `diff-engine` / `causality`) and a small page-side capture half (`fiber` / `instrumentation`), bridged by `protocol`. Dependencies flow one way.

## Status

The observability core is **demoable end-to-end**: fiber capture, tree, inspector, timeline, time travel, Explain, Doctor, sessions, and the extension shell.

Deferred for later: Agent UI on top of `@react-lens/agent`, Canvas/LOD timeline, network adapters.

See [ROADMAP.md](ROADMAP.md) for the living checklist, [DESIGN.md](DESIGN.md) for architecture, and [INTERFACES.md](INTERFACES.md) for package contracts.

## Contributing

Issues and PRs welcome. For local work:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm dev:playground   # fastest feedback loop
```

Keep changes scoped; match existing TypeScript and UI patterns in `apps/devtools`.

## License

[MIT](LICENSE)
