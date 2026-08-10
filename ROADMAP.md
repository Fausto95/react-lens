# React Lens — Roadmap

Living checklist of what's built and what's next. See [DESIGN.md](DESIGN.md) for
architecture and [INTERFACES.md](INTERFACES.md) for package contracts.

Legend: ✅ done · 🚧 in progress · ⬜ not started

---

## Foundation

- ✅ Monorepo scaffold (pnpm workspace, strict TS, vitest + happy-dom)
- ✅ `DESIGN.md` — architecture decisions
- ✅ `INTERFACES.md` — package contracts
- ✅ Git repo + roadmap-driven pushes

## Core packages (pure, framework-free)

- ✅ **`protocol`** — branded IDs, `SerializedValue`, `LensEvent`, messages, snapshots
- ✅ **`serializer`** — safe serialization, reference-identity table, never-throw (16 tests)
- ✅ **`diff-engine`** — universal diff, value + DOM, `ChangeKind` classification (12 tests)
- ✅ **`trace-engine`** — normalized log, ring buffers, per-component history, subscriptions (10 tests)
- ✅ **`causality`** — why-did-this-render (3 levels), confidence, no-observable-change verdict (5 tests)
- ⬜ **`diagnostics`** — Doctor rules over `(ast, runtimeEvidence)` via OXC (interface first, rules later)
- ⬜ **`source-maps`** — runtime component ↔ source location

## Page-side (runs in the inspected page)

- ✅ **`fiber`** — owned React hook (chains existing), DOM↔Fiber↔Component, commit capture, compiler-status best-effort
- ✅ **`instrumentation`** — commit + interaction events → `LensEvent`, DOM snapshots, batching, overhead self-report

Verified against **real React 19** (integration tests): mount + state + prop
re-render counting, prop-change reasons, DOM→component resolution, and
**hook/state/ref/memo/context extraction** (heuristic classification off the
fiber's hook list). All packages: **46 tests passing**, full `tsc -b` clean.

## Apps

- ✅ **`devtools`** — React 19 panel: semantic tree + **single-scroll inspector** (collapsible auto-hiding sections). **Expandable object explorer**, **live-editable primitive props/state** via renderer overrides, and a **DOM section** (captured markup + highlight-on-page)
- ✅ **`playground`** — React 19 + Compiler app engineered to misbehave; dev overlay mounts the panel
- ✅ **`extension`** — MV3 shell (stateless background relay, ISOLATED+MAIN content scripts, devtools page, panel); builds clean
- ✅ **`ui`** / **`icons`** — shared `Section`/`Badge` primitives + a small SVG icon set (`IconLens`/`IconBolt`/…), wired into the panel (foundational extraction; more primitives to migrate)

## Vertical slices (the demoable milestones)

1. ✅ **Transport** — page → panel frames (embedded direct + extension port)
2. ✅ **Fiber resolution** — DOM node → component identity (verified vs React 19)
3. ✅ **First magic moment** — click → inspector → renders + source + why + diff
4. ✅ **Render diff wired** — props + DOM diff in the inspector
5. ✅ **Why did this render?** — causality with no-observable-change verdict
6. ⬜ **Doctor** — OXC findings mapped to components with runtime cost

## Semantic tree + graph projections (plan v2)

The expanded plan reframes the tree as the centerpiece: one unified graph engine
with multiple **projections** rather than a raw fiber tree.

- ✅ **`tree`** — semantic ownership tree, repeated-component grouping, ancestor-preserving projection filter, flatten to virtual rows (6 tests)
- ✅ **Tree pane** — Components / Changed / Potential-Waste modes, flame bars + telemetry, expand/collapse, selection→inspector, **bidirectional hover→page highlight**, resizable dock, **row virtualization**
- ✅ **`graph`** — unified `GraphNode`/`GraphEdge` model + ownership/causality/context projections, `focus()` Focus Lens (7 tests); wired into a Relations inspector section with click-to-navigate
- ✅ **Render overlay** — React-Scan-style heat flashes + cumulative counts, `⚡ Renders` toggle
- ✅ **⌘K command palette** + structured search language (`renders:>20`, `compiled:false`, `visual-change:false`; parser has 7 tests)
- ✅ **Compiler detection** — via `fiber.updateQueue.memoCache` (the reliable signal); shown as ◆ badges
- ✅ **Source locations** — best-effort from React 19 `_debugStack` (creation site)
- ✅ **Timeline + commit scrubber**, **Freeze Frame**, **Tree Diff**, **Update Wave** — commit-grouped store + panel scrubber
- ✅ **Timeline redesign (time-travel MVP-1)** — interaction-first colored blocks over a
  log-scaled heat track; global time cursor (Timeline/Tree/Inspector) with LIVE/PAST +
  historical Inspector (◷); A/B marks → Compare diff; compressed idle gaps; anomaly
  markers; play mode + whole-timeline/scoped replay; per-component render waterfall
  (expanded). Deferred to later phases: Canvas/worker-LOD, screenshots/thumbnails, full
  track stack, Instant Replay, tree-topology patches, session compare/HMR/story mode.
- ✅ **`source-maps`** — resolve compiled `_debugStack` coords to original source
- ✅ **`diagnostics` (Doctor v1)** — impact-ranked rules over runtime evidence; inspector section + tree ⚕ badges + issue count
- ⬜ **Effect debugger** — effect-execution events, run/cleanup counts, loop detection
- ⬜ Network, Sessions, Agent layer

## Resolved

- **Per-commit render attribution** — previously over-reported (identity
  heuristic flagged anything rendered in the last two commits), so replay/
  freeze/waste showed the whole app. Now uses React's `PerformedWork` flag with
  `subtreeFlags` pruning: count a fiber only if it performed work, descend only
  where a descendant did. Accurate per-commit sets (verified: isolated updates
  no longer leak siblings). Regression test in `instrumentation`.

## Known follow-ups

- **Doctor static rules.** v1 is runtime-evidence only. Static AST rules
  (inline context value, effect-derives-state, …) need source fetched via
  `source-maps` + an OXC/AST parse in a worker — the next Doctor layer, which
  also upgrades source to the definition site.
- ✅ **Doctor worker** — the all-components Doctor pass (`diagnoseAll`, causality
  per render) now runs in a Web Worker mirroring the store via `TraceStore.onIngest`
  + `export()`; the panel consumes `{count, affected}` async and the old
  800-component guard is gone. Falls back to a synchronous pass if the worker
  can't spawn.
- **Tree worker** — virtualization mounts few rows, but grouping/projection/query
  still run on the main thread; move to a worker for very large apps (the
  per-render Doctor/verdict pass is now off-thread; the tree build is not).
- **ui/icons** — foundational extraction done; migrate the remaining panel
  primitives (rows, value view, diff lines) into `ui`.
- **Editing in the extension** — live prop/state editing is embedded-only;
  needs a message hop to the injected runtime.
- ✅ **Website (`apps/site`)** — the site inspects itself: a Vite React SPA that
  boots the runtime and mounts the real panel over its own marketing sections
  (Hero/five-questions, TRACE/GRAPH/DIFF specimens, Install). Follow-up: wire a
  static deploy (GH Pages/Vercel) and add prerendered meta for SEO.

## North star

Time To Explanation (TTE) < 10s for common React rendering problems.
