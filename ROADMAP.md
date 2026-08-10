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
- ⬜ **`ui`** / **`icons`** — extract the panel's components into a keyboard-first design system

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
- ⬜ **Tree Diff / Freeze Frame / Update Wave** — need timeline + session-recording infra
- ⬜ **Effect debugger** — effect-execution events, run/cleanup counts, loop detection
- ⬜ **Doctor** (`diagnostics` + `source-maps` via OXC), then Network, Sessions, Agent layer

## Known follow-ups

- **Source locations are best-effort.** React 19 dropped `_debugSource`; we parse
  the `_debugStack` creation site, so it points at the JSX usage site and the
  line reflects the compiled module (offset by the React Compiler transform).
  Definition-site resolution needs a real source-map step (part of the Doctor slice).
- **Tree worker** — virtualization mounts few rows, but grouping/projection/query
  still run on the main thread; move to a worker for very large apps.
- Extract `ui`/`icons`; add the Doctor (`diagnostics` + `source-maps`) slice.

## North star

Time To Explanation (TTE) < 10s for common React rendering problems.
