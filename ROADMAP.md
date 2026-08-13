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
- ✅ **`diagnostics`** — Doctor rules over runtime evidence + static AST/regex; fused impact via `mergeStaticAndRuntime`; OXC in Doctor worker when bundler allows (main thread stubs)
- ✅ **`source-maps`** — runtime component ↔ original source (page-proxied fetch in extension)
- ✅ **`explain`** — deterministic interaction narrative (cost / waste / chain / doctor / next click)
- ✅ **`agent`** — closed TRACE/GRAPH/DIFF tool loop + OpenAI-compatible BYOK

## Page-side (runs in the inspected page)

- ✅ **`fiber`** — owned React hook (chains existing), DOM↔Fiber↔Component, commit capture, compiler-status best-effort
- ✅ **`instrumentation`** — commit + interaction events → `LensEvent`, DOM snapshots, batching, overhead self-report

Verified against **real React 19** (integration tests): mount + state + prop
re-render counting, prop-change reasons, DOM→component resolution, and
**hook/state/ref/memo/context extraction** (heuristic classification off the
fiber's hook list). All packages: **600+ tests**, full `tsc -b` clean.

## Apps

- ✅ **`devtools`** — React 19 panel: semantic tree + **single-scroll inspector** (collapsible auto-hiding sections). **Expandable object explorer**, **live-editable primitive props/state** via renderer overrides, and a **DOM section** (captured markup + highlight-on-page). Selecting a component **scrolls the inspected app to it** when it's off-screen, and the highlight tracks the page as it moves
- ✅ **`playground`** — React 19 + Compiler app engineered to misbehave; dev overlay mounts the panel
- ✅ **`extension`** — MV3 shell (stateless background relay, ISOLATED+MAIN content scripts, devtools page, panel); builds clean
- ✅ **`ui`** / **`icons`** — shared `Section`/`Badge` primitives + a small SVG icon set (`IconLens`/`IconBolt`/…), wired into the panel (foundational extraction; more primitives to migrate)

## Vertical slices (the demoable milestones)

1. ✅ **Transport** — page → panel frames (embedded direct + extension port)
2. ✅ **Fiber resolution** — DOM node → component identity (verified vs React 19)
3. ✅ **First magic moment** — click → inspector → renders + source + why + diff
4. ✅ **Render diff wired** — props + DOM diff in the inspector
5. ✅ **Why did this render?** — causality with no-observable-change verdict
6. ✅ **Doctor** — runtime findings + static fusion; OXC attempted in worker (regex fallback)
7. ✅ **Explain this interaction** — one-click deterministic narrative on Timeline / ⌘K
8. ✅ **Agent (BYOK)** — in-panel drawer (✨ topbar button, ⌘I) over the typed tool loop; see the Agent layer entry below for the full scope

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
  (expanded). **Canvas/worker-LOD + columnar viewport queries** now land (see
  Known follow-ups). Deferred: screenshots/thumbnails, full track stack,
  tree-topology patches, session compare/HMR/story mode.
- ✅ **Real time travel** (supersedes "Instant Replay") — scrubbing the playhead
  restores the page's actual state, Redux-DevTools-style: page-side raw-state ring
  (`instrumentation.timeTravel`, dev builds only) applied via `overrideHookState`/class
  `forceUpdate`; panel computes delta apply-sets (`applySetAt`/`diffApplySet`); recording
  pauses while traveling; go-live restores live baselines. Timeline rewind toggle (on by
  default when supported), purple playhead while driving the page, Space-play = true
  state replay. Extension channel with auto-go-live on panel disconnect. Limits: state/
  reducer/class state only (no refs/external stores/uncontrolled inputs), effects re-run,
  no unmount of later-born components (DESIGN §10.5).
- ✅ **`source-maps`** — resolve compiled `_debugStack` coords to original source
- ✅ **`diagnostics` (Doctor v1)** — impact-ranked rules over runtime evidence; inspector section + tree ⚕ badges + issue count
- ✅ **Effect debugger** — timed `EffectEvent`s (run + cleanup + hookIndex) via `onPostCommitFiberRoot`; Effects tab with counts, durations, and a "possible loop" badge
- ✅ **Editing in the extension** — panel `edit-setProp` / `edit-setHookState` / `edit-setText` hop to injected `overrideProps` / hook state (parity with embed)
- ✅ **Page Inspect mode** — crosshair pick (⌘\\), hover highlight + source tooltip, sticky select, inline leaf-text edit (React override then ephemeral DOM badge)
- ✅ **Open in editor** — Source tab + inspect tooltip → `cursor://` / `vscode://`
- ✅ **Explain verdicts** — expected vs avoidable, waste share, one actionable next step (still deterministic / no LLM)
- ✅ **Sessions** — export/import the TraceStore as `.json` (topbar + ⌘K), IndexedDB recents (capped at 20) with "Open · …" reload
- ⬜ Network adapters
- ✅ **Agent layer (BYOK)** — multi-turn streamed conversation (`createAgentSession`)
  over 11 typed tools; `why` carries diff evidence + cause source, and
  `read_component_source` (definition-scoped, line-numbered) enables concrete fenced
  `tsx file:line` fix proposals with Copy / Open-in-editor. Evidence pack + budgets +
  strict arg validation; compiler invariant enforced in the prompt; citations are
  clickable Lens ID tokens driving selection and the time cursor. Panel wiring: ✨
  topbar button, ⌘I, ⌘K command; providers OpenAI / Claude / Z.AI GLM (corrected
  Anthropic-compatible base URL, browser CORS opt-in header, `storage` permission for
  session-scoped keys).

## Resolved

- **Per-commit render attribution** — previously over-reported (identity
  heuristic flagged anything rendered in the last two commits), so replay/
  freeze/waste showed the whole app. Now uses React's `PerformedWork` flag with
  `subtreeFlags` pruning: count a fiber only if it performed work, descend only
  where a descendant did. Accurate per-commit sets (verified: isolated updates
  no longer leak siblings). Regression test in `instrumentation`.

## Known follow-ups

- **Reliability pipeline** — Phase 1 (seq/ack content-script ring, heartbeat,
  WAL, poison quarantine, protocol handshake) in tree. Phase 2: TraceStore +
  WAL + causality live in a supervised trace worker; **ingest is
  worker-authoritative** (panel sync mirror updates from `{ type: "ingested" }`,
  not dual-write on the hot path). Columnar `TimelineIndex` + LOD pyramids +
  prefix-sum stats + typed `TraceQuery` protocol. Causality / diff run in
  dedicated workers and write wasted flags into the index. Phase 3: Doctor
  WASM/`analyzeSourceSmart` (extension still stubs oxc for Chrome worker CSP),
  session export/import + per-`sessionId` segment archive/stitch on the trace
  worker. Phase 4: OffscreenCanvas timeline base paint with transferable
  columnar geometry + main-thread fallback. Tiered HOT/WARM/COLD retention
  (IDB cold chunks) + SUMMARY LOD pyramids. Remaining: chaos e2e, percentage
  Compiler ratchet, fully drop the sync mirror once all inspector reads are
  query-shaped.
- **Doctor static rules.** Runtime + static fusion ships via `mergeStaticAndRuntime`.
  Playground / e2e-fixture / site leave `oxc-parser` unstubbed (WASM via the
  package `browser` field + `@oxc-parser/binding-wasm32-wasi`); regex fallback
  when load fails. Extension build keeps an explicit oxc stub.
- ✅ **Doctor worker** — the all-components Doctor pass (`diagnoseAll`, causality
  per render) now runs in a Web Worker mirroring the store via `TraceClient.onFrame`
  - `export()`; the panel consumes `{count, affected}` async and the old
    800-component guard is gone. Falls back to a synchronous pass if the worker
    can't spawn. Selected component source is uploaded for static fusion.
    Source-map resolve also runs in the doctor worker.
- ✅ **Source fetch via page** — extension `source-request` / `source` hop so the
  panel resolver reads modules same-origin to the inspected app.
- **Compiler gates** — oxlint `react/rules-of-hooks`, `react/exhaustive-deps`,
  and `react/react-compiler` at error; CI runs `check:compiled` +
  `check:compiled:build` on every PR. Percentage ratchet TODO in
  `scripts/check-compiled.mjs`.
- ✅ **Tree worker path** — virtualization mounts few rows; flat-tree columns +
  `queryWindow` / `useTreeWindow` keep projections viewport-bounded; full
  semantic `buildTree` still available for grouping modes.
- **ui/icons** — foundational extraction done; migrate the remaining panel
  primitives (rows, value view, diff lines) into `ui`.
- ✅ **Website (`apps/site`)** — the site inspects itself: a Vite React SPA that
  boots the runtime and mounts the real panel over its own marketing sections
  (Hero, REWIND/WHY/DIFF specimens, Features, Install, Agents). Follow-up: wire a
  static deploy (GH Pages/Vercel) and add prerendered meta for SEO.
- ✅ **Columnar timeline database** — `TimelineIndex` append-only typed arrays,
  binary-search hit testing, prefix-sum region stats, LOD buckets, incremental
  stack rows, wasted flags from causality (no WHY_CAP sweep). OpsBoard scale
  scenario + `playwright.perf.config.ts`.

## North star

Time To Explanation (TTE) < 10s for common React rendering problems.

---

## AI-Friendliness (agent / CLI / MCP)

- ✅ **A1 — `@reactlens/agent-tools`** — typed tool handlers + budgets; panel wired
- ✅ **A2 — Session schema + CLI** — `protocol/session`, JSON Schema, `react-lens analyze`
- ✅ **A3 — MCP over session files** — `@reactlens/mcp` stdio server, `react-lens mcp`, AGENTS.md playbook
- ✅ **A4 — Live dev channel (MVP)** — `@reactlens/dev-channel` WebSocket + Vite stub + `attachDevChannelSink`
- ✅ **A5 — Verify loop** — `InteractionEvent.name`, `markInteraction`, `@reactlens/playwright`, `compare_sessions`
- ✅ **A6 — CI + evals** — `react-lens ci`, `--update-baseline`, `eval-smoke.mjs`
