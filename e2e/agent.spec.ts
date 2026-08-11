import { test, expect } from "@playwright/test";
import { boot, bumpCounter, openaiSse, seedAgentKey } from "./helpers.js";

/**
 * AI drawer with a mocked OpenAI SSE provider — covers streaming text,
 * tool-activity chips, [component:N] citation navigation (closes drawer),
 * and copy. Fully offline against the agent plumbing.
 */

test("mocked OpenAI stream: chips, citations, copy, and drawer close", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await boot(page);
  await bumpCounter(page, 1);
  await seedAgentKey(page);
  await page.reload();
  await expect(page.locator(".rl-root")).toBeVisible();
  await expect(page.locator(".rl-tree-name", { hasText: /^App$/ }).first()).toBeVisible();

  let call = 0;
  await page.route("**/v1/chat/completions", async (route) => {
    call += 1;
    if (call === 1) {
      const body = openaiSse([
        {
          tool_calls: [
            {
              index: 0,
              id: "call_find",
              type: "function",
              function: { name: "find_component", arguments: '{"name":"HooksShowcase"}' },
            },
          ],
        },
      ]);
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body,
      });
      return;
    }

    const req = route.request().postDataJSON() as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const toolMsg = [...(req.messages ?? [])].reverse().find((m) => m.role === "tool");
    let componentId = 1;
    try {
      const parsed = JSON.parse(toolMsg?.content ?? "{}") as {
        matches?: Array<{ componentId: number }>;
      };
      componentId = parsed.matches?.[0]?.componentId ?? 1;
    } catch {
      /* keep fallback */
    }
    const body = openaiSse([
      { content: "HooksShowcase is the counter. See " },
      { content: `[component:${componentId}]` },
      { content: " for the live instance." },
    ]);
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body,
    });
  });

  await page.getByRole("button", { name: "AI assistant (⌘I)" }).click();
  const drawer = page.locator(".rl-agent");
  await expect(drawer).toBeVisible();

  await drawer.locator("textarea").fill("Where is HooksShowcase?");
  await drawer.getByRole("button", { name: "Ask" }).click();

  await expect(drawer.locator(".rl-agent-chip", { hasText: /find_component/ })).toBeVisible({
    timeout: 15_000,
  });

  const cite = drawer.locator(".rl-narrative-chip.rl-md-cite").first();
  await expect(cite).toBeVisible({ timeout: 15_000 });
  await expect(drawer.locator(".rl-agent-turn.assistant")).toContainText(/HooksShowcase/);

  await drawer.getByRole("button", { name: "Copy answer" }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toMatch(/HooksShowcase/);

  await cite.click();
  await expect(drawer).toHaveCount(0);
  await expect(page.locator(".rl-insp-head h2")).toHaveText(/HooksShowcase/);
});
