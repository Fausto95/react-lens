import { describe, expect, it, beforeEach } from "vite-plus/test";
import type { Interaction, TraceStore } from "@reactlens/trace-engine";
import type { CommitId, ComponentId, RenderId } from "@reactlens/protocol";
import { InteractionList } from "./InteractionList.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
});

async function mount(element: unknown) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  await React.act(async () => {
    root.render(element as never);
  });
  return { container, root, React };
}

const cid = (n: number) => n as ComponentId;
const rid = (n: number) => n as RenderId;
const commit = (n: number) => n as CommitId;

function interaction(
  over: Partial<Interaction> & Pick<Interaction, "id" | "label" | "kind">,
): Interaction {
  return {
    start: 100,
    end: 180,
    renderIds: [rid(1), rid(2)],
    commitIds: [commit(1), commit(2)],
    metrics: {
      totalDuration: 80,
      reactDuration: 12.4,
      renderCount: 2,
      stateUpdates: 1,
      componentIds: [cid(1), cid(2), cid(3)],
    },
    ...over,
  };
}

function mockStore(waste = 0): TraceStore {
  return {
    subscribe: () => () => undefined,
    statsInRange: () => ({ renders: 2, wasted: waste, selfMs: 12 }),
  } as unknown as TraceStore;
}

describe("InteractionList", () => {
  const items = [
    interaction({ id: "load", label: "Load", kind: "load", start: 0, end: 40 }),
    interaction({
      id: "i1",
      label: "Click CartButton",
      kind: "click",
      start: 100,
      metrics: {
        totalDuration: 80,
        reactDuration: 12.4,
        renderCount: 42,
        stateUpdates: 1,
        componentIds: [cid(1), cid(2), cid(3)],
      },
    }),
    interaction({
      id: "sys1",
      label: "Clock",
      kind: "system",
      start: 200,
      metrics: {
        totalDuration: 5,
        reactDuration: 2,
        renderCount: 3,
        stateUpdates: 0,
        componentIds: [cid(9)],
      },
    }),
  ];

  async function render(selectedId: string | null = "i1", waste = 0) {
    const React = await import("react");
    return mount(
      React.createElement(InteractionList, {
        store: mockStore(waste),
        interactions: items,
        totalCount: items.length,
        selectedId,
        t0: 0,
        onSelect: () => undefined,
      }),
    );
  }

  it("gives each interaction exactly one line", async () => {
    const { container } = await render();
    const rows = container.querySelectorAll(".rl-cascade-interaction");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.querySelector(".title")).not.toBeNull();
      expect(row.querySelector(".react")).not.toBeNull();
      // The four-number footer is gone; nothing expands in place any more.
      expect(row.querySelector(".foot")).toBeNull();
      expect(row.querySelector(".nren")).toBeNull();
    }
  });

  it("marks the selected row and pips the kind", async () => {
    const { container } = await render();
    const selected = container.querySelector(".rl-cascade-interaction.selected")!;
    expect(selected.querySelector(".kind-pip.kind-gesture")).not.toBeNull();
    expect(selected.querySelector(".react")!.textContent).toBe("12.4ms");
    expect(container.querySelector('[data-kind="load"] .kind-pip.kind-load')).not.toBeNull();
    expect(container.querySelector('[data-kind="system"] .kind-pip.kind-system')).not.toBeNull();
  });

  it("paints cost as the row's own fill, scaled to the worst in view", async () => {
    const { container } = await render();
    const worst = container.querySelector<HTMLElement>('[data-kind="gesture"]')!;
    const cheap = container.querySelector<HTMLElement>('[data-kind="system"]')!;
    expect(worst.style.getPropertyValue("--rail-cost")).toBe("100.0%");
    expect(cheap.style.getPropertyValue("--rail-cost")).toBe("16.1%");
  });

  it("moves the numbers it no longer shows into the tooltip", async () => {
    const { container } = await render("i1", 3);
    const tip = container.querySelector('[data-kind="gesture"]')!.getAttribute("title") ?? "";
    expect(tip).toMatch(/42 renders/);
    expect(tip).toMatch(/3 wasted/);
    expect(tip).toMatch(/3 components/);
    expect(tip).toMatch(/2 commits/);
    expect(tip).toMatch(/wall/);
  });

  it("warns about wasted renders without spending a column on it", async () => {
    const { container } = await render("i1", 3);
    const dot = container.querySelector(".rl-cascade-interaction .waste-dot");
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute("aria-label")).toMatch(/3 wasted renders/);
  });

  it("shows no warning when nothing was wasted", async () => {
    const { container } = await render("i1", 0);
    expect(container.querySelector(".waste-dot")).toBeNull();
  });

  it("offers a sort control and reorders on it", async () => {
    const { container, React } = await render();
    const order = () =>
      [...container.querySelectorAll(".rl-cascade-interaction .title")].map((e) => e.textContent);
    // Session order by default, so "follow latest" keeps the newest at the end.
    expect(order()).toEqual(["Load", "Click CartButton", "Clock"]);

    const slow = [...container.querySelectorAll(".rl-rail-sort button")].find(
      (b) => b.textContent === "Slow",
    ) as HTMLButtonElement;
    await React.act(async () => {
      slow.click();
    });
    expect(order()).toEqual(["Click CartButton", "Load", "Clock"]);
  });
});
