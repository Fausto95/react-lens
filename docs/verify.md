# Verify loop

Name an interaction in the page, capture a session, then compare before vs
after a fix — in Playwright, MCP (`compare_sessions`), or `react-lens ci`.

## Mark interactions in the page

The capture runtime exposes:

```ts
window.__REACT_LENS__.markInteraction(name, untilMs?);
```

Named interactions show up on the timeline and key session compare / CI by
`InteractionEvent.name`.

## Playwright helper

```ts
import { lens } from "@reactlens/playwright";

await lens(page).interaction("add-to-cart", async () => {
  await page.getByRole("button", { name: "Add" }).click();
});
```

`lens(page).interaction` calls `markInteraction` around your callback so the
trace window lines up with the test step.

Wire capture into your fixture (or use `apps/e2e-fixture` / the playground as
a reference), export or persist the session JSON after the run.

## Compare sessions

Via MCP / agent-tools:

```ts
compare_sessions({ before, after });
```

Deltas are keyed by interaction name — same name in baseline and actual.

## CI

```bash
# After capturing actual/*.json for each named interaction:
pnpm react-lens ci --baseline ./baselines --actual ./actual

# Accept the new numbers:
pnpm react-lens ci --update-baseline --baseline ./baselines --actual ./actual
```

Exit code `1` on regression. Details: [cli.md](cli.md).

## Suggested flow

1. Name critical user paths (`checkout`, `filter-list`, …).
2. Capture a **baseline** session per path (good build or post-fix).
3. After a change, capture **actual** sessions with the same names.
4. Run `react-lens ci` in CI, or hand both payloads to an agent with
   `compare_sessions`.

## Related

- [Sessions](sessions.md) — file shape and redaction
- [MCP](mcp.md) — agent-side compare
- [INTERFACES.md](../INTERFACES.md) — `@reactlens/playwright`
