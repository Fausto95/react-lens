import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ComponentId, ComponentInstance } from "@react-lens/protocol";
import { createInspectController } from "./inspectController.js";
import type { LensRuntime } from "./runtime.js";

interface FakeComponent {
  id: number;
  name: string;
  node: HTMLElement;
}

function makeRuntime(components: FakeComponent[]) {
  const byNode = new Map<Node, FakeComponent>(components.map((c) => [c.node, c]));
  const byId = new Map<number, FakeComponent>(components.map((c) => [c.id, c]));
  return {
    resolveComponent: (node: Node): ComponentInstance | null => {
      let cur: Node | null = node;
      while (cur) {
        const hit = byNode.get(cur);
        if (hit) {
          return {
            id: hit.id as ComponentId,
            name: hit.name,
            kind: "component",
            compiler: { compiled: false },
          } as unknown as ComponentInstance;
        }
        cur = cur.parentNode;
      }
      return null;
    },
    domNodesOf: (id: ComponentId) => {
      const hit = byId.get(id as unknown as number);
      return hit ? [hit.node] : [];
    },
    canEditValues: () => true,
    setProp: () => true,
    store: {
      renderCount: () => 7,
      selfTimeTotal: () => 12.4,
    },
  } as unknown as LensRuntime;
}

function makeHighlighter() {
  return { show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
}

function mouseMove(target: Element, x = 40, y = 40): void {
  target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.getElementById("react-lens-inspect-tip")?.remove();
});

describe("inspect mode — host state sync", () => {
  it("notifies the host when Escape stops inspecting", () => {
    const states: boolean[] = [];
    const ctl = createInspectController({
      runtime: makeRuntime([]),
      highlighter: makeHighlighter(),
      onPick: () => {},
      onStateChange: (on) => states.push(on),
    });
    ctl.start();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(ctl.isActive()).toBe(false);
    expect(states).toEqual([true, false]);
    ctl.dispose();
  });

  it("deactivates when the window blurs", () => {
    const states: boolean[] = [];
    const ctl = createInspectController({
      runtime: makeRuntime([]),
      highlighter: makeHighlighter(),
      onPick: () => {},
      onStateChange: (on) => states.push(on),
    });
    ctl.start();
    window.dispatchEvent(new Event("blur"));
    expect(ctl.isActive()).toBe(false);
    expect(states).toEqual([true, false]);
    ctl.dispose();
  });
});

describe("inspect mode — text editing", () => {
  it("Escape during an edit restores the original text and keeps inspecting", () => {
    const p = document.createElement("p");
    p.textContent = "hello";
    document.body.appendChild(p);
    const ctl = createInspectController({
      runtime: makeRuntime([{ id: 1, name: "Para", node: p }]),
      highlighter: makeHighlighter(),
      onPick: () => {},
    });
    ctl.start();
    p.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(p.contentEditable).toBe("true");
    p.textContent = "edited away";
    p.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(p.textContent).toBe("hello");
    expect(ctl.isActive()).toBe(true);
    ctl.dispose();
  });
});

describe("inspect mode — ancestor walking", () => {
  it("Alt+wheel up walks to the parent component; down returns", () => {
    const outer = document.createElement("div");
    const inner = document.createElement("span");
    inner.textContent = "leaf";
    outer.appendChild(inner);
    document.body.appendChild(outer);
    const highlighter = makeHighlighter();
    const ctl = createInspectController({
      runtime: makeRuntime([
        { id: 1, name: "Outer", node: outer },
        { id: 2, name: "Inner", node: inner },
      ]),
      highlighter,
      onPick: () => {},
    });
    ctl.start();
    mouseMove(inner);
    expect(highlighter.show).toHaveBeenLastCalledWith([inner]);

    inner.dispatchEvent(new WheelEvent("wheel", { bubbles: true, altKey: true, deltaY: -1 }));
    expect(highlighter.show).toHaveBeenLastCalledWith([outer]);
    expect(document.getElementById("react-lens-inspect-tip")!.textContent).toContain("Outer");

    inner.dispatchEvent(new WheelEvent("wheel", { bubbles: true, altKey: true, deltaY: 1 }));
    expect(highlighter.show).toHaveBeenLastCalledWith([inner]);
    ctl.dispose();
  });

  it("a pick while walked up picks the walked component, not the deepest", () => {
    const outer = document.createElement("div");
    const inner = document.createElement("span");
    outer.appendChild(inner);
    document.body.appendChild(outer);
    const picks: number[] = [];
    const ctl = createInspectController({
      runtime: makeRuntime([
        { id: 1, name: "Outer", node: outer },
        { id: 2, name: "Inner", node: inner },
      ]),
      highlighter: makeHighlighter(),
      onPick: (p) => picks.push(p.componentId as unknown as number),
    });
    ctl.start();
    mouseMove(inner);
    inner.dispatchEvent(new WheelEvent("wheel", { bubbles: true, altKey: true, deltaY: -1 }));
    inner.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(picks).toEqual([1]);
    ctl.dispose();
  });
});

describe("inspect mode — tooltip", () => {
  it("shows render count and self time for the hovered component", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const ctl = createInspectController({
      runtime: makeRuntime([{ id: 1, name: "Card", node: el }]),
      highlighter: makeHighlighter(),
      onPick: () => {},
    });
    ctl.start();
    mouseMove(el);
    const tip = document.getElementById("react-lens-inspect-tip")!;
    expect(tip.textContent).toContain("Card");
    expect(tip.textContent).toContain("7×");
    expect(tip.textContent).toContain("12.4");
    ctl.dispose();
  });
});
