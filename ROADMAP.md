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
re-render counting, prop-change reasons, DOM→component resolution.
All packages: **45 tests passing**, full `tsc -b` clean.

## Apps

- ✅ **`devtools`** — React 19 panel: ranked component list, inspector, render history, why-did-this-render, props diff
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

## Known follow-ups

- **Compiler detection.** The playground has the React Compiler enabled, yet
  the panel reports components as "not compiled". Either the babel plugin isn't
  transforming or the memo-cache heuristic in `fiber` is too weak — investigate
  (DESIGN §7 flagged this risk). Until resolved, compiled status is best-effort.
- **`_debugSource`** is absent in React 19 production-ish builds, so source
  locations may be unavailable; needs a source-map path.
- Extract `ui`/`icons`; add the Doctor (`diagnostics` + `source-maps`) slice.

## North star

Time To Explanation (TTE) < 10s for common React rendering problems.
