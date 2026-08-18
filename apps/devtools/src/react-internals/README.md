# React execution evidence

React Internals is not a competing top-level workspace. The product surface is **Cascade**, with React runtime evidence exposed as an optional X-ray layer over the same causal graph.

The primary `@reactlens/devtools/panel` entry keeps Cascade mounted and adds a `React` toggle. The layer deliberately does **not** show a second profiler timeline. It derives a short, ranked list of things that change what the developer should do next from the latest commit, then links each finding back into the normal Cascade inspector.

Examples of surfaced evidence:

- **wasted render** — React rendered the component but causality found no observable output change
- **identity churn** — a prop/state/context value is structurally equal but referentially new, breaking memoized consumers
- **React Compiler bailout** — the captured compiler bailout reason is shown before suggesting manual memoization
- **context fan-out** — a context invalidation reached a component and produced a meaningful downstream cascade
- **parent-only cascade** — a component woke up with no own props/state/context change
- **external-store invalidation** — a store subscription, rather than local React inputs, triggered the render
- **forced update** — normal React change detection was bypassed
- **effect-heavy work** — effect work is material relative to the render and the captured hook index/phase is shown when available

Every finding includes the concrete captured reason, relevant change rows, downstream size/cost when useful, and a **Next:** action. Clicking a finding selects that component in Cascade so the existing inspector can show the full Cause → Change → Cost → Fix → Triggered story.

`ReactInternalsPanel` remains exported as an experimental standalone surface for adapter development, but it is not primary navigation.

## Runtime ownership

React Lens already owns the React DevTools hook at `document_start` through `@reactlens/fiber`, and `@reactlens/instrumentation` normalizes its commit/render signal into the shared `TraceStore`. Production Cascade consumes that existing live signal rather than installing a second private-internals hook.

The Bippy adapter remains an isolated seam for experiments and future enrichment. Raw Fiber objects must not leak into UI state; normalize useful fields before they reach Cascade.

The intended direction is progressive disclosure:

- default Cascade: causal structure and render cost
- React layer: ranked, actionable React findings
- click a finding: select the exact component in Cascade and inspect the evidence chain
- semantic zoom: eventually surface reasons/bailouts/effects directly on graph nodes when there is enough room
- raw Fiber: advanced/debug-only drawer, never the default UI
