# React execution data

React Internals is no longer a competing top-level workspace. The product surface is **Cascade**, with React runtime information exposed as an optional X-ray layer over the same causal graph.

The primary `@reactlens/devtools/panel` entry keeps Cascade mounted and adds a `React` toggle. When enabled, the execution layer shows the latest React commit inline: interaction/passive origin, rendered Fiber work scaled by self time, commit identity/span, and click-through Fiber details (self/subtree timing, parent and source).

`ReactInternalsPanel` remains exported as an experimental standalone surface for adapter development, but it is not primary navigation.

## Runtime ownership

React Lens already owns the React DevTools hook at `document_start` through `@reactlens/fiber`, and `@reactlens/instrumentation` normalizes its commit/render signal into the shared `TraceStore`. Production Cascade consumes that existing live signal rather than installing a second private-internals hook.

The Bippy adapter remains an isolated seam for experiments and future enrichment. Raw Fiber objects must not leak into UI state; normalize useful fields (lanes, flags, tags, hook transitions, owner/source data, bailouts/effects) before they reach Cascade.

The intended direction is progressive disclosure:

- default Cascade: causal structure and render cost
- React layer: commit/work information inline
- selected work item: richer Fiber-derived metadata
- future semantic zoom: lanes/flags/reasons on nodes as zoom increases
- raw Fiber: advanced/debug-only drawer, never the default UI
