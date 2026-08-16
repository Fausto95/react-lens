# React Internals workspace

The production workspace is wired to React Lens' existing live Fiber-backed trace.

React Lens already installs and owns the React DevTools hook at `document_start` through `@reactlens/fiber`. That bridge observes commits before the app's React runtime starts and feeds normalized render/component evidence into the shared `TraceStore`. The React Internals workspace reads that same store, so it works in both the Chrome extension and the embedded playground without installing another private-internals hook.

## Why not install Bippy in production too?

Bippy solves the same low-level access problem by patching the React DevTools hook. Running it beside React Lens' own hook would add another private-internals owner and another compatibility surface across React versions. The panel therefore keeps a small `ReactInternalsRuntimeAdapter` / Bippy event contract for experiments, but production uses the hook React Lens already owns.

## Data flow

```text
React runtime
    ↓
@reactlens/fiber (document_start DevTools hook)
    ↓
@reactlens/instrumentation
    ↓
TraceStore
    ↓
ReactInternalsPanel
```

Raw Fiber objects never enter persisted trace state or React component state. The workspace works with stable React Lens component ids, commit timing, parent relationships, render counts, self time, and source locations.

Future enrichment can normalize additional low-level fields — tags, flags, lanes, hook state transitions, owners, effect work, and bailout information — inside the owned Fiber bridge without changing the workspace API.
