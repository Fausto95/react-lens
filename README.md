# React Lens

> React observability for development. See why your React app behaves the way it does.

React Lens answers five questions fast: **what is this element, why did it
render, why is it slow, what changed, and how do I fix it.** It is built around
three primitives — **TRACE** (what happened), **GRAPH** (why), and **DIFF**
(what changed) — over one normalized event log.

See [DESIGN.md](DESIGN.md) for architecture, [INTERFACES.md](INTERFACES.md) for
package contracts, and [ROADMAP.md](ROADMAP.md) for status.

## Monorepo layout

```
packages/
  protocol/         shared event + message contract (zero deps)
  serializer/       safe value serialization with reference identity
  diff-engine/      universal diff over values and DOM
  trace-engine/     normalized event log, ring buffers, queries
  causality/        why-did-this-render, confidence, verdicts
  fiber/            owned React DevTools hook, DOM↔Fiber↔Component
  instrumentation/  commits + interactions → batched LensEvents
apps/
  devtools/         React 19 panel (component list, inspector, why, diff)
  playground/       React 19 + Compiler app engineered to misbehave
  extension/        MV3 Chrome extension wiring the panel to any page
```

Design principle: a pure, framework-free analysis core
(`trace-engine`/`diff-engine`/`causality`) and a small page-side capture half
(`fiber`/`instrumentation`), bridged by `protocol`. Dependencies flow one way.

## Quick start

```bash
pnpm install
pnpm test        # 45 unit + integration tests (incl. real React 19)
pnpm exec tsc -b # strict typecheck across packages
```

### Try the playground (embedded panel, no extension needed)

```bash
pnpm dev:playground
```

Open the page and click a product. The in-page panel captures every render and
explains it — e.g. a `ProductCard` that re-renders on a new `onSelect` function
identity with **no observable DOM change**, flagged *potentially avoidable* with
calibrated confidence.

### Build the Chrome extension

```bash
pnpm build:extension
```

Load `apps/extension/dist` as an unpacked extension (`chrome://extensions` →
Developer mode → Load unpacked), then open DevTools → **React Lens**.

## Status

The observability core is complete and verified end to end (see the ROADMAP).
The extension shell builds and mirrors the verified embedded pipeline over the
Chrome messaging transport. Not yet built: full timeline, network adapters,
static Doctor rules, sessions, and the agent layer.
