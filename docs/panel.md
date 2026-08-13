# Panel

The React Lens panel (Chrome DevTools tab or embedded dock) is the human
surface over the same event log the CLI and MCP use.

## Shortcuts

| Shortcut | Action |
| -------- | ------ |
| ⌘K | Command palette — commands + fuzzy component jump |
| ⌘I | AI assistant (BYOK) |
| ⌘\\ | Page inspect — crosshair pick an element |
| ⚡ | Toggle render overlay (heat flashes) |

Timeline (focus the timeline; press `?` for the full list):

| Shortcut | Action |
| -------- | ------ |
| Space | Play / pause (loops only with an A/B region) |
| J / K / L | Reverse / stop / forward (tap again = faster) |
| ⇧ ← / → | Previous / next commit |
| [ / ] | Set A / B at the playhead |
| End / `.` | Go live (resume capture) |
| Esc | Clear A/B region |
| Pinch / ⌘+scroll | Zoom at cursor |
| Click empty wave | Zoom loupe |
| Double-click clip | Zoom to clip |

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

## Timeline

- **Interaction-first** blocks over a heat track; idle gaps compress.
- **LIVE / PAST** cursor — scrubbing enters PAST; End / `.` returns to LIVE.
- **A/B marks** — compare two Lens commits (not git commits) for a whole-app
  change index.
- **Wave loupe** — click empty wave space to zoom a local window.
- **Lane solo/mute** — view-only lane filter, persisted in panel prefs.
- **Replay with fix** — preview the tree as if wasted renders were skipped
  before you change code.

## Inspector

Props, state, hooks, DOM, and source for the selection. Live-edit primitives
via the React 19 renderer override API. Diffs show value + DOM change for the
selected render; the Change / Triggered sections show what a clip caused.

## Doctor, waste, Explain

- **AST Doctor** — OXC (or regex fallback) fused with runtime evidence;
  findings at `file:line`. Yellow pastille → impact-ranked issue menu.
- **Waste banner** — after an interaction settles, jumps to the worst
  no-observable-change offender.
- **Explain this interaction** — deterministic cost / cause / Doctor / next
  step (no LLM).

## Sessions

Export / import the full trace as JSON from ⌘K. Recent sessions live in
IndexedDB (capped). Format details: [sessions.md](sessions.md).

## Preferences

Stored under `react-lens/panel-prefs` (localStorage):

| Pref | Default | Notes |
| ---- | ------- | ----- |
| `travelOn` | `true` | Page follows the playhead during time travel |
| `maxEvents` | `10_000` | Trace ring (1k–500k) |
| `maxAgeMs` | unlimited | Optional 1 / 5 / 15 minute window |
| `theme` | `dark` | `system` / `light` / `dark` |
| `revealOnSelect` | `true` | Scroll the page to off-screen selections |
| Column / lane prefs | — | Tree / inspector widths, collapsed rails, lane solo/mute |

Agent provider settings (API key, model, base URL) stay in
`react-lens/agent-settings` — browser / extension storage only; keys never
leave the machine.
