import { describe, expect, it, beforeEach } from "vite-plus/test";
import type { ComponentId } from "@reactlens/protocol";
import { RestoreIndicator } from "./RestoreIndicator.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
});

async function mount(props: Parameters<typeof RestoreIndicator>[0]) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const container = document.getElementById("root")!;
  const root = createRoot(container);
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
    menu: () => document.querySelector<HTMLElement>(".rl-restore-menu"),
    rows: () => [...document.querySelectorAll<HTMLElement>(".rl-restore-row")],
  };
}

const cid = (n: number) => n as ComponentId;

describe("RestoreIndicator — healthy", () => {
  it("stays quiet: no component count, no warning, nothing to open", async () => {
    // 199 restored components is not news. The chip's job while everything
    // works is to be ignorable.
    const ui = await mount({ applied: 199, failures: [], storesApplied: 4, storeFailures: [] });
    expect(ui.chip().textContent).toBe("state · 4 stores");
    expect(ui.chip().className).not.toContain("partial");
    await ui.click();
    expect(ui.menu()).toBeNull();
  });

  it("omits the store count when no store is registered", async () => {
    const ui = await mount({ applied: 12, failures: [], storesApplied: 0, storeFailures: [] });
    expect(ui.chip().textContent).toBe("state");
  });

  it("singularises one store", async () => {
    const ui = await mount({ applied: 1, failures: [], storesApplied: 1, storeFailures: [] });
    expect(ui.chip().textContent).toBe("state · 1 store");
  });
});

describe("RestoreIndicator — partial", () => {
  const oneStore = {
    applied: 199,
    failures: [],
    storesApplied: 3,
    storeFailures: [{ storeId: "cart", reason: "no-snapshot" as const }],
  };

  it("names what failed, not how many succeeded", async () => {
    const ui = await mount(oneStore);
    expect(ui.chip().textContent).toContain("1 store didn't rewind");
    expect(ui.chip().textContent).not.toContain("199");
    expect(ui.chip().className).toContain("partial");
  });

  it("says component when the failure is a component", async () => {
    const ui = await mount({
      applied: 3,
      failures: [{ id: cid(7), name: "PriceTag", reason: "no-fiber" as const }],
      storesApplied: 0,
      storeFailures: [],
    });
    expect(ui.chip().textContent).toContain("1 component didn't rewind");
  });

  it("counts both kinds together when they mix", async () => {
    const ui = await mount({
      applied: 3,
      failures: [{ id: cid(7), name: "PriceTag", reason: "no-fiber" as const }],
      storesApplied: 1,
      storeFailures: [{ storeId: "cart", reason: "apply-failed" as const }],
    });
    expect(ui.chip().textContent).toContain("2 didn't rewind");
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
