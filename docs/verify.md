# Verify loop

Name an interaction in the page, export a session, then compare before vs after
a fix — via MCP (`compare_sessions`) or `react-lens ci`.

## Mark interactions in the page

Embedded capture runtimes (`createCaptureRuntime` — playground, site,
e2e-fixture) expose:

```ts
window.__REACT_LENS__.markInteraction(name, untilMs?);
```

The Chrome extension inject path does **not** install this global today.
Named interactions show up on the timeline; within a session compare they key
deltas by interaction label (`ev.name` when set).

## Playwright helper

```ts
import { lens } from "@reactlens/playwright";

await lens(page).interaction("add-to-cart", async () => {
  await page.getByRole("button", { name: "Add" }).click();
});
```

`lens(page).interaction` calls `markInteraction(name)` once at the start of
the callback. The named window closes on the capture runtime’s
`interactionWindowMs` (default ~200ms) — it does not wait for `fn` to finish.
Pass a longer `untilMs` via `markInteraction` directly when you need a wider
window. Export or persist the session JSON after the run (the Playwright
package does not capture sessions itself).

## Compare sessions

Via MCP / agent-tools — pass **payloads** (the `payload` field of a session
file), not the wrapping `LensSessionFile`:

```ts
compare_sessions({ before: before.payload, after: after.payload });
```

Deltas are keyed by interaction label. MCP is bound to one `--session` for
other tools; both sides of `compare_sessions` must be supplied in the call.

## CI

```bash
# Files are paired by filename under each directory:
pnpm react-lens ci --baseline ./baselines --actual ./actual

# Accept the new numbers:
pnpm react-lens ci --update-baseline --baseline ./baselines --actual ./actual
```

Exit code `1` on regression. Details: [cli.md](cli.md).

## Suggested flow

1. Name critical user paths (`checkout`, `filter-list`, …).
2. Capture a **baseline** session file per path (good build or post-fix).
3. After a change, capture **actual** sessions with the **same filenames**.
4. Run `react-lens ci`, or hand both payloads to an agent with
   `compare_sessions`.

## Related

- [Sessions](sessions.md) — file shape and sensitivity
- [MCP](mcp.md) — agent-side compare
- [INTERFACES.md](../INTERFACES.md) — `@reactlens/playwright`
