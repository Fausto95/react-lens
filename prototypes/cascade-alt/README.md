# Cascade — alternate representations

Three prototypes for the same cascade projection, to compare against the current
node-link canvas (`apps/devtools/src/cascade/`).

```bash
npx vite prototypes --port 5193
```

Then open `/cascade-alt/`. Data is synthetic (`data.js`) but shaped exactly like
`CascadeNode` — `{ name, parentId, cause, selfDuration, depth }` — and modelled on the
marketing-site interaction in the current screenshot.

## What's wrong with the current view

- The projection is a **tree** (every node has one `parentId`), but it's drawn as a
  node-link DAG. That costs a full canvas, a bus-routing algorithm, and a lot of
  eye-tracking for a relation an indent expresses for free.
- Every clip is fixed-width and most read `0.0ms`, so the layout encodes **nothing** about
  cost. The one signal that matters is invisible.
- Depth columns fill the screen at 29 nodes. A real interaction is hundreds; the projection
  already has to defend itself with `maxVisibleNodes: 1200` and leaf aggregation.
- Repetition is scattered: 7 `Reveal`, 4 `Consumer`, 2 `Svg` sit in different columns with
  no visual grouping.

## 1 · Ledger

Indented tree list. Depth → indentation, so the cascade reads top-to-bottom in reading
order and windows to thousands of rows with the existing `rowWindow` machinery.

- Repeated leaf siblings fold to one `Consumer ×4` row.
- Two bars per row: solid = self time, ghost = subtree time — where the cost _lives_,
  without expanding.
- Keyboard: `↑↓` move, `←→` fold/parent, `/` filter (filter keeps ancestors).
- Right rail is the "why" chain from the root cause down, with cause per hop.

Trade-off: loses the sense of _simultaneous fan-out_. You see 7 `Reveal` as 7 lines, not as
one wide burst.

## 2 · Blast rings

Radial depth map. Root cause at the hub, one ring per causal depth, arc width ∝ share of
downstream renders, fill strength ∝ cost share (sqrt, so cheap nodes don't dissolve).

Answers "how far and how wide did this update propagate" before you read a single name —
which is the question the current view is _trying_ to answer and doesn't. Hover lights the
path back to the hub.

Trade-off: labels only fit on arcs longer than ~34px, so the widest ring is often
unlabelled. This is a _shape_ view, not a _reading_ view — it pairs with the ledger, it
doesn't replace it.

## 3 · Roll-up

Aggregate by component instead of by render: 33 nodes → 20 rows. Count, cause mix, depth
range, self ms, share, verdict (`hot`, `pass-through`, `rendered N×`).

This is the one that actually answers "what do I fix". `Consumer ×6 · all context ·
pass-through` is a memo/selector bug in one line; you'd never read that off the graph.

## Recommendation

Ship **3 as the landing view**, **1 as the drill-down**, and keep the graph as an optional
lens. 2 is worth building if the interaction shape itself is a thing users reason about
(deep-and-narrow vs wide-and-shallow) — otherwise it's the weakest of the three.
