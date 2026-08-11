# React Lens — Technical Design

Pre-scaffold architecture. This document is the reference for the initial
implementation and is meant to travel with the code (updated in the same commit
as the behavior it describes).

Target environment: **React 19 with the React Compiler enabled**. The Compiler
being on is an architectural input, not a footnote — see §1.4 and §7.

---

## 1. Guiding constraints

These are the forces that dictate the shape. Everything below is downstream of
them.

### 1.1 The observer must not perturb the observed

The injected runtime executes in the **page's** JS context at high event
frequency under a strict overhead budget (idle ≈ 0, recording < 5% CPU,
bounded memory, never active in production unless explicitly enabled). This is
the dominant constraint: the page side does **capture + minimal normalization
only**. Everything expensive — diff, causality, ranking, layout, static
analysis — runs off the page (in the panel's worker).

### 1.2 One-way layering

`page runtime → protocol → devtools store → workers → UI`. Inner layers never
import outer ones. `protocol` depends on nothing and is the seam.

### 1.3 Single source of truth

The normalized **event log** is the only authoritative state. Render history,
"why did this render", diffs, and the health score are all _derived_ from it —
never mirrored, never written by the UI.

### 1.4 React Compiler is on

A component may re-render because the Compiler _could not_ memoize it (e.g.
unsupported mutation), not because of a developer mistake. Compiler status is a
**first-class input to the causality engine**, captured per component and
surfaced as evidence. Consequences:

- We never recommend adding `useMemo`/`useCallback`/`memo`. When a render is
  "suspicious", the explanation references compiler bailout reasons, not manual
  memoization.
- The playground runs with the Compiler on so our heuristics are validated
  against compiled output, not hand-memoized code.

---

## 2. Three primitives

The entire product is three operations over one event log:

- **TRACE** — what happened (query the log).
- **GRAPH** — why it happened (walk reconstructed `causedBy` edges).
- **DIFF** — what changed (compare two snapshots).

"Why did ProductCard render?" = find its `RenderEvent` (TRACE) → walk its causes
(GRAPH) → diff previous vs current snapshot (DIFF).

---

## 3. Package boundaries

pnpm workspace monorepo. Dependencies flow strictly downward.

```
apps/
  extension/        MV3 shell: background relay, content script, devtools page
  devtools/         panel UI (React 19 + Compiler)
  playground/       React 19 + Compiler app engineered to misbehave

packages/
  protocol/         [zero deps] message types, versioning, SerializedValue, IDs
  serializer/       [protocol] safe value serialization + stable identity table
  fiber/            [protocol] page-side DOM↔Fiber↔Component, OWNED hook
  instrumentation/  [protocol, fiber, serializer] capture → LensEvent
  trace-engine/     [protocol] normalized log, ring buffers, queries
  diff-engine/      [protocol, serializer] universal diff (pure)
  causality/        [protocol, trace-engine, diff-engine] why-did-this-render
  diagnostics/      [protocol] Doctor rules (pure; OXC-based static analysis)
  source-maps/      [protocol] runtime component ↔ source location
  ui/               [icons] design system, keyboard-first primitives
  icons/            [zero deps]
```

### The two-half split

- **Page half** (`fiber`, `serializer`, `instrumentation`): runs inside the
  inspected page. Size- and speed-critical. No React. No heavy logic.
- **Analysis half** (`trace-engine`, `diff-engine`, `causality`,
  `diagnostics`): pure, framework-free, runs in a **Web Worker** owned by the
  devtools app. Unit-testable with zero framework.
- `protocol` bridges the halves.

### `diff-engine` is one engine

Not per-domain diff implementations. It takes two `DiffTarget` snapshots and a
**strategy table keyed by target kind** (declarative dispatch, no `switch`
ladder). Props/state/context/hooks/DOM all reduce to one `DiffResult`. It is
built and tested standalone before any consumer wires into it. This is the
moat.

---

## 4. Transport chain (Chrome MV3)

```
page:  injected runtime (instrumentation)
   │   window.postMessage — protocol frames only, structured-clone-safe
content script (isolated world)
   │   chrome.runtime port
background service worker  — STATELESS relay, keyed by tabId
   │   chrome.runtime port
devtools page → devtools panel (the app + worker + trace-engine)
```

Decisions:

- **Background worker holds no trace state.** MV3 terminates it; it is a dumb,
  reconnect-tolerant relay keyed by `tabId`. Authoritative state lives in the
  panel's `trace-engine`.
- **We never serialize the app's object graph.** The page sends structured
  snapshots and references. A function becomes
  `{ type: "function", identity: "fn_812", name: "handleClick" }`. This is what
  makes function/object identity diffing possible (§6) and is the reason
  `serializer` is built early.
- Every frame is `LensMessage { protocolVersion: 1, type, payload }`.
  Versioning exists from commit one; runtime and panel will drift.

---

## 5. Core data model

```ts
// protocol — the single source of truth is a log of these
interface BaseEvent {
  id: EventId;
  timestamp: number;
  componentId?: ComponentId;
  interactionId?: InteractionId;
  causedBy?: EventId[]; // reconstructed by `causality`, NOT captured
}

type LensEvent =
  | InteractionEvent
  | RenderEvent
  | StateChangeEvent
  | PropsChangeEvent
  | ContextChangeEvent
  | EffectEvent
  | NetworkEvent
  | QueryEvent
  | LayoutEvent
  | PaintEvent
  | DiagnosticEvent;
```

**Capture and inference are separated.** The page runtime captures raw events;
`causality` reconstructs `causedBy` edges afterward, each carrying a
**confidence** value (solid = known, dashed = inferred). "Why did this render?"
is then a query, answered at three progressive-disclosure levels (parent
rerender → what state/context changed → the originating call site + event).

Snapshots (`RenderSnapshot`) live in **ring buffers with hard caps** (e.g. 100
renders/component, 10k events) so we never retain the app graph. `WeakRef` for
live fiber back-references; serialized snapshots for history.

---

## 6. Diff engine v1 — Value + DOM

Scope for v1 (confirmed):

- **Semantic value diff**: props/state/context/hooks. Classifies each change as
  `VALUE_CHANGED | REFERENCE_ONLY_CHANGED | FUNCTION_IDENTITY_CHANGED | ADDED |
REMOVED | STRUCTURE_CHANGED | UNCHANGED`. This is what powers "why did this
  render" and the render diff — e.g. "onClick reference changed, everything else
  structurally equal".
- **DOM snapshot diff**: compare DOM output between renders so we can make the
  strong claim _"this render produced no DOM change"_ — the evidence behind
  "suspicious render". Surfaces semantic node/attr/text changes, not raw HTML
  noise.

Deferred: CSS/computed-style diff, pixel/visual diff (screenshots),
component-tree diff, performance/session diff. `DiffTarget` is designed as an
open union so these slot in without touching the engine core.

Display language is human and never overclaims: "potentially avoidable",
"no observable DOM change", with an attached confidence — never a bare
"unnecessary render".

---

## 7. Fiber access — owned injected hook

We install **our own** React hook before React loads (the way React DevTools
does), owning the commit callbacks (`onCommitFiberRoot` and friends) rather than
piggybacking on `__REACT_DEVTOOLS_GLOBAL_HOOK__`. Rationale: conflict-free when
official React DevTools is also installed, and we control the commit-timing and
compiler-metadata extraction we depend on.

Consequences for scaffolding:

- The extension must inject `fiber`'s hook at `document_start`, before page
  scripts, via a `world: "MAIN"` content script (or an injected `<script>` from
  the content script) so it wins the hook slot.
- `fiber` exposes a stable interface (`resolveComponent(domNode)`,
  `onCommit(cb)`, `getCompilerStatus(fiber)`) so instrumentation and the panel
  never touch React internals directly. If the internal shape changes, only
  `fiber` changes.
- We still cooperate defensively if the official hook is already present
  (chain, don't clobber) to avoid breaking the page's other tooling.

---

## 8. Doctor — in-panel via OXC

Static analysis runs **inside the panel's worker** using an OXC (WASM) parser.
Source is pulled via `source-maps` from the inspected page. No external process
or language server.

- `diagnostics` rules are **pure**: `(ast, runtimeEvidence) → Diagnostic[]`.
  They take runtime evidence as input so a finding like "inline context value"
  can be reported _with_ its measured downstream render cost — the static +
  runtime combination that is the real differentiator.
- Rules are a declarative registry (id, matcher, evidence requirements,
  severity, explanation, suggested-alternative), not a hand-rolled chain.
- Compiler-aware: rules must not flag things the Compiler already handles, and
  must understand compiler-bailout as a legitimate cause.

---

## 9. Panel state architecture

Three separated stores, never merged:

- **UI state** → Zustand. Narrow `Object.is`-stable selectors. No manual
  memoization (Compiler assumed). One render path per component.
- **Trace store** → plain normalized log, _outside React_, updated by batched
  appends. Components subscribe to narrow slices. High-frequency events never go
  through `setState`.
- **Derived analysis** → computed in the worker, cached by input hash.

Timeline and large graphs render to **Canvas** (worker produces draw commands
from a viewport query), not thousands of DOM nodes.

**Bidirectional selection.** Every pick — tree, ⌘K, timeline bar, relations,
waste banner, page inspect — goes through one writer in `Panel` (`select`), so
the page can never disagree with the inspector. That writer asks the page to
_reveal_ the component: highlight it and, when its box sits outside the
viewport, scroll it into view (`revealGeometry.ts` owns the decision;
`prefers-reduced-motion` is honoured, and the pref is user-disableable). Hover
only ever highlights — a mousemove-rate event must not move the page. Because
the highlight boxes are `position: fixed`, the highlighter tracks capture-phase
scroll and resize while visible, coalesced to one repaint per frame; without
that the outline drifts off its component the moment anything moves.

---

## 10. Build sequence (vertical slices)

Sequenced by provable seam; each slice is independently demoable and, where
pure, test-first (red before green, tests in a separate commit).

1. **Protocol + serializer + transport** — page→panel round-trip "ping".
   Establishes the overhead-budget benchmark harness _before_ load is added.
2. **`fiber` (owned hook) resolution** — DOM → Fiber → Component. Deliverable:
   click element → component identity.
3. **First vertical slice** — hover → inspector → source + render count. The
   magic moment.
4. **`diff-engine` standalone** (value + DOM), then wire props/state/context/DOM
   diff into the inspector.
5. **`causality` v1** — "why did this render?" over a single interaction.
6. **`diagnostics` + `source-maps`** — OXC findings mapped to components with
   runtime cost attached.

---

## 10.5 Time travel — raw values stay page-side

Scrubbing the timeline playhead restores the inspected app's real state (Redux
DevTools semantics), not a re-enactment. Three decisions make it sound:

1. **Raw values never leave the page.** `SerializedValue` is lossy by design
   and has no inverse. Instead, the page-side instrumentation keeps bounded
   per-component rings (`componentId → renderId → raw state/reducer hook
values + class state`, `TIME_TRAVEL_RETENTION` mirrors the panel's render
   ring so both sides evict together; references not clones, dev builds
   only). The panel computes only _which_ `(componentId, renderId)` pairs
   constitute time t — `applySetAt(store, t)` over `renderAtOrBefore` — and
   sends that apply set plus the cursor time; the page looks up raw values
   and writes them back via the renderer's dev-only `overrideHookState`
   (empty path = whole-value replace, raw hook-list index) and, for classes,
   fiber `memoizedState`/`baseState` rewrite + `forceUpdate`. Failures come
   back per entry (`no-history` / `no-fiber` / `shape-mismatch` /
   `write-failed`) and surface in the panel as a partial-restore pill and
   per-component markers.

2. **Recording pauses while traveling** (suppressed at the instrumentation
   source, not tag-and-filtered). The restore flush commits through the same
   reconciler the bridge observes, in a microtask _after_ the apply loop — a
   per-call flag can't mark it. A mode flag can: while active, no commit or
   effect events are emitted, so the timeline stays frozen and there is no
   feedback loop. Go-live restores per-component live baselines captured on
   first touch, then resumes recording one macrotask later.

3. **Deltas only.** The panel controller rAF-coalesces scrub positions and
   diffs the apply set against what was last applied (`diffApplySet`), so a
   drag re-applies just the components whose target render changed.

**External stores are opt-in, not inferred.** Overriding a
`useSyncExternalStore` hook's memoized value cannot work generically: the
value would revert on the store's next notification, and the store itself
would still hold the live state. Instead the page registers
`TimeTravelStoreAdapter { id, getSnapshot, applySnapshot }`
(`runtime.timeTravel.registerStore(...)`); snapshots are captured per commit
into the same retention-bounded history and rewound to the snapshot at or
before the cursor time sent with each apply. Zustand maps to
`getState`/`setState(s, true)`, Redux to `getState`/a hydrate action. The
playground's `ExternalStoreDemo` is the reference.

**Explicitly out of scope** (deliberate, not deferred):

- _Generic `useSyncExternalStore` rewind_ — see above; the adapter seam is
  the supported path.
- _Props overrides_ — props derive from parent state; rewinding the parent
  already covers them, and a second writer would fight the reconciler.
- _Mount/unmount topology patches_ — components mounted after t stay mounted
  (the tree dims them); unmounted ones cannot come back (ROADMAP: deferred).
- _Uncontrolled inputs_ — writing `.value` fights focus/selection; the
  offline commit DOM snapshots show their values instead.

Known limits (documented in the toggle tooltip): only `useState`/`useReducer`/
class state and registered store adapters rewind — not refs, unregistered
module state, uncontrolled inputs, or server state; effects re-run against
rewound values; production React builds have no override API, so the toggle
is disabled. Imported sessions never drive the live page (their renderIds
belong to a different run) — they play back throttled whole-page DOM
snapshots instead (§ CommitSnapshot). In the extension, the content script
auto-sends go-live when the panel port disconnects so a closed panel never
leaves the app in the past.

---

## 10.6 Agent — grounded answers, concrete fixes (BYOK)

The assistant's job is the five questions (what is this element / why did it
render / why is it slow / what changed / how do I fix it), answered from the
recorded trace — never from vibes. Three design rules keep it honest:

1. **The tools carry the evidence, not summaries of it.** `why` returns each
   cause's diff summary, top changed paths (e.g. `onSelect` →
   FUNCTION_IDENTITY_CHANGED) and source location; `read_component_source`
   returns the user's original code, line-numbered and scoped to the
   component's definition (`diagnostics.definitionSpan`) — which is what makes
   a proposed fix a real fenced `tsx file:line` patch instead of generic
   advice. An evidence pack (session stats, interactions, top components,
   commit anomalies, compiler coverage) rides in the first turn so tool steps
   go to analysis, not discovery.
2. **Budgets and strict arguments.** Every tool result is capped before it
   reaches the model (with a truncation note it can react to); invalid ids are
   rejected with a recovery hint naming the right lookup tool — never silently
   defaulted to a plausible-looking 0.
3. **The compiler invariant is in the prompt.** React Compiler is assumed on;
   the agent must never recommend manual `useMemo`/`useCallback`/`memo` for a
   compiled component (§1.4) and prefers fixes that restore compiler
   memoization at the cause site.

BYOK: keys live in `chrome.storage.session` (extension) or localStorage
(embedded), and leave the machine only as auth headers to the user-chosen
provider. Answers cite Lens ID tokens the panel renders as chips that drive
selection and the time cursor; fenced fixes get Copy and Open-in-editor.
Applying changes to disk is out of scope by construction — the panel is a
browser page.

---

## 11. Stack

TypeScript (strict; no `any` in public APIs, `unknown` + narrow), React 19 +
React Compiler, Vite, pnpm, vanilla-extract, Zustand, IndexedDB (sessions),
Web Workers, Canvas/OffscreenCanvas, OXC (WASM, static analysis), Playwright
(browser tests), Storybook (visual). No React Query for high-frequency local
trace state.

---

## 12. North star

**Time To Explanation (TTE)** < 10s for common React rendering problems: from
"developer notices issue" to "developer understands root cause".
