import { describe, expect, it, beforeEach, afterEach } from "vite-plus/test";
import type { ComponentId } from "@reactlens/protocol";
import { RestoreIndicator } from "./RestoreIndicator.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Roots are unmounted between tests, not just detached: this component listens
 * on `document` while its popover is open, so a leaked root would react to the
 * next test's Escape and try to clean up DOM that no longer exists.
 */
const mounted: Array<{ unmount: () => void }> = [];

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
});

afterEach(async () => {
  const React = await import("react");
  await React.act(async () => {
    for (const root of mounted.splice(0)) root.unmount();
  });
});

async function mount(props: Parameters<typeof RestoreIndicator>[0]) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  mounted.push(root);
  await React.act(async () => {
    root.render(React.createElement(RestoreIndicator, props) as never);
  });
  const chip = () => container.querySelector<HTMLButtonElement>(".rl-restore-chip")!;
  return {
    container,
    React,
    chip,
    async click() {
      await React.act(async () => {
        chip().click();
      });
    },
    async rerender(next: Parameters<typeof RestoreIndicator>[0]) {
      await React.act(async () => {
        root.render(React.createElement(RestoreIndicator, next) as never);
      });
    },
    menu: () => document.querySelector<HTMLElement>(".rl-restore-menu"),
    rows: () => [...document.querySelectorAll<HTMLElement>(".rl-restore-row")],
  };
}

const cid = (n: number) => n as ComponentId;

describe("RestoreIndicator — healthy", () => {
  it("stays quiet: a glyph, the store count, nothing to open", async () => {
    // 199 restored components is not news, and a toolbar has no room for a
    // sentence. The chip's job while everything works is to be ignorable.
    const ui = await mount({ applied: 199, failures: [], storesApplied: 4, storeFailures: [] });
    expect(ui.chip().textContent).toBe("4");
    expect(ui.chip().className).not.toContain("partial");
    expect(ui.chip().querySelector("svg")).not.toBeNull();
    await ui.click();
    expect(ui.menu()).toBeNull();
  });

  it("shows the glyph alone when no store is registered", async () => {
    const ui = await mount({ applied: 12, failures: [], storesApplied: 0, storeFailures: [] });
    expect(ui.chip().textContent).toBe("");
    expect(ui.chip().querySelector("svg")).not.toBeNull();
  });

  it("carries the full sentence in the accessible name and tooltip", async () => {
    // The words did not disappear, they moved: nothing is only-visual.
    const ui = await mount({ applied: 1, failures: [], storesApplied: 1, storeFailures: [] });
    const expected = "Every component's state follows the playhead, and 1 store";
    expect(ui.chip().getAttribute("aria-label")).toBe(expected);
    expect(ui.chip().title).toBe(expected);
  });
});

describe("RestoreIndicator — partial", () => {
  const oneStore = {
    applied: 199,
    failures: [],
    storesApplied: 3,
    storeFailures: [{ storeId: "cart", reason: "no-snapshot" as const }],
  };

  it("shows the failure count, not how many succeeded", async () => {
    const ui = await mount(oneStore);
    expect(ui.chip().textContent).toBe("1");
    expect(ui.chip().textContent).not.toContain("199");
    expect(ui.chip().className).toContain("partial");
  });

  it("names the failing kind in the accessible name", async () => {
    const ui = await mount(oneStore);
    expect(ui.chip().getAttribute("aria-label")).toContain("1 store didn't rewind");
  });

  it("says component when the failure is a component", async () => {
    const ui = await mount({
      applied: 3,
      failures: [{ id: cid(7), name: "PriceTag", reason: "no-fiber" as const }],
      storesApplied: 0,
      storeFailures: [],
    });
    expect(ui.chip().getAttribute("aria-label")).toContain("1 component didn't rewind");
  });

  it("counts both kinds together when they mix", async () => {
    const ui = await mount({
      applied: 3,
      failures: [{ id: cid(7), name: "PriceTag", reason: "no-fiber" as const }],
      storesApplied: 1,
      storeFailures: [{ storeId: "cart", reason: "apply-failed" as const }],
    });
    expect(ui.chip().textContent).toBe("2");
    expect(ui.chip().getAttribute("aria-label")).toContain("2 didn't rewind");
  });

  it("opens a popover explaining each failure in plain language", async () => {
    const ui = await mount({
      applied: 3,
      failures: [{ id: cid(7), name: "PriceTag", reason: "no-fiber" as const }],
      storesApplied: 1,
      storeFailures: [{ storeId: "cart", reason: "no-snapshot" as const }],
    });
    await ui.click();
    const menu = ui.menu();
    expect(menu).not.toBeNull();
    expect(menu!.textContent).toContain("cart");
    expect(menu!.textContent).toContain("No snapshot this far back");
    expect(menu!.textContent).toContain("PriceTag");
    expect(menu!.textContent).toContain("Unmounted since capture");
    // Stores first: they are whole-app, so they explain more of the screen
    // than any single component does.
    expect(ui.rows()[0]!.textContent).toContain("cart");
  });

  it("component rows select; store rows are inert", async () => {
    const selected: ComponentId[] = [];
    const ui = await mount({
      applied: 3,
      failures: [{ id: cid(7), name: "PriceTag", reason: "no-fiber" as const }],
      storesApplied: 1,
      storeFailures: [{ storeId: "cart", reason: "no-snapshot" as const }],
      onSelect: (id) => selected.push(id),
    });
    await ui.click();
    const [storeRow, componentRow] = ui.rows();
    expect(storeRow!.tagName).toBe("DIV");
    expect(componentRow!.tagName).toBe("BUTTON");
    await ui.React.act(async () => {
      (componentRow as HTMLButtonElement).click();
    });
    expect(selected).toEqual([cid(7)]);
  });

  it("hides the popover when everything recovers", async () => {
    // Scrubbing to a cursor where every store has history: the explanation is
    // no longer true, so it must not stay on screen.
    const ui = await mount(oneStore);
    await ui.click();
    expect(ui.menu()).not.toBeNull();
    await ui.rerender({ applied: 199, failures: [], storesApplied: 4, storeFailures: [] });
    expect(ui.menu()).toBeNull();
  });

  it("closes on Escape", async () => {
    const ui = await mount(oneStore);
    await ui.click();
    expect(ui.menu()).not.toBeNull();
    await ui.React.act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(ui.menu()).toBeNull();
  });

  it("lists every failure — a truncated list would hide the cause", async () => {
    const ui = await mount({
      applied: 0,
      failures: Array.from({ length: 9 }, (_, i) => ({
        id: cid(i + 1),
        name: `C${i + 1}`,
        reason: "no-history" as const,
      })),
      storesApplied: 0,
      storeFailures: [],
    });
    await ui.click();
    expect(ui.rows()).toHaveLength(9);
  });
});
