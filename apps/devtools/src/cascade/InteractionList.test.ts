import { describe, expect, it, beforeEach } from "vite-plus/test";
import type { Interaction, TraceStore } from "@reactlens/trace-engine";
import type { CommitId, ComponentId, RenderId } from "@reactlens/protocol";
import { InteractionList, interactionKindTone } from "./InteractionList.js";

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

describe("interactionKindTone", () => {
  it("maps load / system / gesture kinds", () => {
    expect(interactionKindTone("load")).toBe("load");
    expect(interactionKindTone("system")).toBe("system");
    expect(interactionKindTone("click")).toBe("gesture");
    expect(interactionKindTone("keypress")).toBe("gesture");
  });
});

describe("InteractionList", () => {
  it("renders kind pip, heat meta with N renders, and expands the selected row", async () => {
    const React = await import("react");
    const items = [
      interaction({ id: "load", label: "Load", kind: "load", start: 0, end: 40 }),
      interaction({
        id: "i1",
        label: "Click CartButton",
        kind: "click",
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
        metrics: {
          totalDuration: 5,
          reactDuration: 2,
          renderCount: 3,
          stateUpdates: 0,
          componentIds: [cid(9)],
          trigger: "state",
        },
      }),
    ];

    const { container } = await mount(
      React.createElement(InteractionList, {
        store: mockStore(3),
        interactions: items,
        totalCount: 3,
        selectedId: "i1",
        t0: 0,
        onSelect: () => undefined,
      }),
    );

    const selected = container.querySelector(".rl-cascade-interaction.selected");
    expect(selected).not.toBeNull();
    expect(selected!.querySelector(".kind-pip.kind-gesture")).not.toBeNull();
    expect(selected!.querySelector(".meta")!.textContent).toMatch(/42\s+renders/);
    expect(selected!.querySelector(".waste")!.textContent).toBe("3");

    const stats = selected!.querySelector(".stats")!.textContent ?? "";
    expect(stats).toContain("click");
    expect(stats).toContain("wall");
    expect(stats).toContain("3 components");
    expect(stats).toContain("2 commits");
    expect(stats).toContain("1 state");
    expect(stats).toContain("3 wasted");

    expect(container.querySelector('[data-kind="load"] .kind-pip.kind-load')).not.toBeNull();
    expect(container.querySelector('[data-kind="system"] .kind-pip.kind-system')).not.toBeNull();

    const collapsed = container.querySelector('[data-kind="load"]');
    expect(collapsed!.querySelector(".stats")).toBeNull();
  });
});
