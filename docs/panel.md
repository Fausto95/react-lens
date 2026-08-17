# Panel

The React Lens panel (Chrome DevTools tab or embedded dock) is the human
surface over the same event log the CLI and MCP use. The redesign shell is
three columns: **Components**, **Cascade**, and **Inspector**.

## Shortcuts

| Shortcut | Action                                            |
| -------- | ------------------------------------------------- |
| ⌘K       | Command palette — commands + fuzzy component jump |
| ⌘I       | AI assistant (BYOK)                               |
| ⌘\\      | Page inspect — crosshair pick an element          |

Embedded panel only: a toolbar control toggles the render overlay (heat
flashes). There is no dedicated keymap for it.

Cascade (focus the Cascade stage; press `?` in the command palette for more):

| Shortcut       | Action                                           |
| -------------- | ------------------------------------------------ |
| F              | Fit the entire cascade in view                   |
| 0              | Reset zoom to 100%                               |
| C              | Collapse expanded aggregate groups               |
| ← / →          | Previous / next interaction                      |
| Drag           | Pan the graph                                    |
| ⌘/ctrl + wheel | Zoom at the cursor                               |
| Esc            | Clear custom Cause / Effects focus (back to All) |
| Minimap drag   | Recenter the viewport                            |

Replay / time travel (Cascade toolbar transport):

| Control       | Action                                                          |
| ------------- | --------------------------------------------------------------- |
| Replay        | Replay the selected interaction (dev builds restore page state) |
| Replay all    | Replay from the start of the recorded window                    |
| Travel toggle | When on, the page follows rewind / replay                       |
| Latest        | Follow the newest interaction as it arrives                     |
| Restore pill  | "12 restored · 2 stores · 1 unavailable" while traveling        |

The restore pill appears once the page is following the playhead. It counts
restored components and [registered stores](stores.md); when something could
not follow, it turns amber, names each one in its tooltip (`cart — no snapshot
this far back`) and clicks through to the first affected component.

## Tree filter

The tree search accepts space-separated AND tokens:

```
renders:>20
self:>5
compiled:true
visual-change:false
wasted:true
name:Cart
/Cart|Checkout/i
```

Bare words are case-insensitive name substrings. Unknown `field:` tokens fall
back to name matching so free text still works.

## Cascade

Cascade is the primary view for an interaction: a causal DAG of renders
(depth on X, order on edges), not a wave/lane scrubber.

- **Interaction rail** — pick which click / load / keydown to inspect; ←/→
  steps through recorded interactions.
- **Viewport** — Fit, 1:1, live zoom %; pan and ⌘/ctrl+wheel zoom; minimap.
- **Focus modes** — All, Expensive (costly + roots), Roots (state / mount
  roots). Cause / Effects dim to the upstream or downstream of the selection.
- **Aggregation** — repeated leaf siblings collapse into one node (expand in
  place; `C` collapses groups again). Pathological fan-out stays within a
  visible-node budget.
- **Replay transport** — Replay / Replay all and the time-travel toggle sit in
  the Cascade toolbar so rewind stays next to the graph that explains the cost.
- **Latest** — keep following new interactions, or unfollow to stay on a past
  one while the app keeps recording.

Go live (resume capture after a rewind) from the command palette: **Go live**.

## Inspector

Props, state, hooks, DOM, and source for the selection. Live-edit primitives
via the React 19 renderer override API. Diffs show value + DOM change for the
selected render; Change / Triggered sections show what a clip caused.

## Doctor, waste, Explain

- **AST Doctor** — static analysis fused with runtime evidence; findings at
  `file:line`. OXC when the bundler allows it; the in-panel Doctor falls back
  to regex. Yellow pastille → impact-ranked issue menu.
- **Waste banner** — after an interaction settles, jumps to the worst
  no-observable-change offender.
- **Explain this interaction** — deterministic cost / cause / Doctor / next
  step (no LLM).
- **Replay with fix** — preview the panel tree as if wasted renders were
  skipped (visualization only; it does not apply a code change).
- **Fix with AI** — stages a BYOK agent question from a Doctor finding; the
  model may propose a `file:line` patch. Nothing is written to disk.

## Sessions

Export / import the full trace as JSON from ⌘K. Recent sessions live in
IndexedDB (capped). Format details: [sessions.md](sessions.md).

## Preferences

Stored under `react-lens/panel-prefs` (localStorage):

| Pref                | Default   | Notes                                                       |
| ------------------- | --------- | ----------------------------------------------------------- |
| `travelOn`          | `true`    | Page follows rewind / replay during time travel             |
| `maxEvents`         | `10_000`  | Trace ring (clamped 1k–500k; menu: 10k / 50k / 100k / 500k) |
| `maxAgeMs`          | unlimited | Optional 1 / 5 / 15 minute window                           |
| `theme`             | `dark`    | `system` / `light` / `dark`                                 |
| `revealOnSelect`    | `true`    | Scroll the page to off-screen selections                    |
| Column / pane prefs | —         | Tree / inspector widths, collapsed rails                    |

Agent provider settings (model, base URL) stay in `react-lens/agent-settings`.
The API key is AES-GCM encrypted there; the wrap key lives in session storage
(`chrome.storage.session` in the extension, `sessionStorage` when embedded) so
durable prefs never hold a usable secret alone. Keys never leave the machine
except as auth to the provider you pick.
