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

Core pure packages total: **43 tests passing**, full `tsc -b` clean.

## Page-side (runs in the inspected page)

- 🚧 **`fiber`** — owned React hook, DOM↔Fiber↔Component, commit capture, compiler status
- ⬜ **`instrumentation`** — commit + browser events → `LensEvent`, batching, overhead budget

## Apps

- ⬜ **`extension`** — MV3 shell (background relay, content script, devtools page)
- ⬜ **`devtools`** — React 19 + Compiler panel; inspector, render history, diff view
- ⬜ **`playground`** — React 19 + Compiler app engineered to misbehave (§89 scenarios)
- ⬜ **`ui`** / **`icons`** — keyboard-first design system

## Vertical slices (the demoable milestones)

1. ⬜ **Transport round-trip** — page → panel ping + overhead-budget harness
2. ⬜ **Fiber resolution** — click element → component identity
3. ⬜ **First magic moment** — hover → inspector → source + render count
4. ⬜ **Render diff wired** — props/state/context/DOM diff in the inspector
5. ⬜ **Why did this render?** — causality over one interaction
6. ⬜ **Doctor** — OXC findings mapped to components with runtime cost

## North star

Time To Explanation (TTE) < 10s for common React rendering problems.
