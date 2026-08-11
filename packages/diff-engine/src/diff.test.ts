import { describe, it, expect } from "vitest";
import { diff } from "./diff.js";
import type { SerializedValue, DOMSnapshot } from "@reactlens/protocol";

const prim = (value: number): SerializedValue => ({ k: "primitive", type: "number", value });
const str = (value: string): SerializedValue => ({ k: "primitive", type: "string", value });
const fn = (identity: string, name?: string): SerializedValue => ({ k: "function", identity, name });
const obj = (identity: string, entries: Array<[string, SerializedValue]>): SerializedValue => ({
  k: "object",
  identity,
  entries,
});

describe("diff — primitives", () => {
  it("reports UNCHANGED for equal primitives", () => {
    const r = diff({ kind: "value", before: prim(1), after: prim(1) });
    expect(r.summary.changed).toBe(0);
    expect(r.changes[0]?.kind).toBe("UNCHANGED");
  });

  it("reports VALUE_CHANGED for differing primitives", () => {
    const r = diff({ kind: "value", before: prim(1), after: prim(2) });
    expect(r.summary.changed).toBe(1);
    expect(r.changes[0]?.kind).toBe("VALUE_CHANGED");
    expect(r.changes[0]?.confidence).toBe(1);
  });
});

describe("diff — functions (the signature case)", () => {
  it("flags FUNCTION_IDENTITY_CHANGED with sub-1 confidence", () => {
    const r = diff({ kind: "props", before: fn("fn_1", "onClick"), after: fn("fn_2", "onClick") });
    const change = r.changes[0];
    expect(change?.kind).toBe("FUNCTION_IDENTITY_CHANGED");
    expect(change?.confidence).toBeLessThan(1); // behavior equivalence unknown
  });

  it("treats same function identity as UNCHANGED", () => {
    const r = diff({ kind: "props", before: fn("fn_1"), after: fn("fn_1") });
    expect(r.summary.changed).toBe(0);
  });
});

describe("diff — objects", () => {
  it("REFERENCE_ONLY_CHANGED when identity differs but structure equal", () => {
    const before = obj("obj_1", [["category", str("books")]]);
    const after = obj("obj_2", [["category", str("books")]]);
    const r = diff({ kind: "props", before, after });
    expect(r.summary.referenceOnly).toBe(1);
    const top = r.changes.find((c) => c.path.length === 0);
    expect(top?.kind).toBe("REFERENCE_ONLY_CHANGED");
  });

  it("UNCHANGED when same object identity", () => {
    const before = obj("obj_1", [["a", prim(1)]]);
    const after = obj("obj_1", [["a", prim(1)]]);
    const r = diff({ kind: "props", before, after });
    expect(r.summary.changed).toBe(0);
  });

  it("detects a deep VALUE_CHANGED and reports its path", () => {
    const before = obj("obj_1", [["price", prim(129)]]);
    const after = obj("obj_2", [["price", prim(139)]]);
    const r = diff({ kind: "props", before, after });
    const deep = r.changes.find((c) => c.path.join(".") === "price");
    expect(deep?.kind).toBe("VALUE_CHANGED");
  });

  it("detects ADDED and REMOVED keys", () => {
    const before = obj("obj_1", [["a", prim(1)]]);
    const after = obj("obj_2", [["b", prim(2)]]);
    const r = diff({ kind: "props", before, after });
    const kinds = r.changes.map((c) => `${c.path.join(".")}:${c.kind}`);
    expect(kinds).toContain("a:REMOVED");
    expect(kinds).toContain("b:ADDED");
  });
});

describe("diff — DOM (observable output)", () => {
  const node = (over: Partial<DOMSnapshot["root"]>): DOMSnapshot => ({
    root: { nodeName: "BUTTON", attributes: { class: "button" }, text: "Add to cart", ...over },
  });

  it("observableOutputChanged is false for identical DOM", () => {
    const r = diff({ kind: "dom", before: node({}), after: node({}) });
    expect(r.summary.observableOutputChanged).toBe(false);
    expect(r.summary.changed).toBe(0);
  });

  it("detects a changed attribute as observable output change", () => {
    const r = diff({
      kind: "dom",
      before: node({}),
      after: node({ attributes: { class: "button", "data-active": "true" } }),
    });
    expect(r.summary.observableOutputChanged).toBe(true);
    expect(r.changes.some((c) => c.path.includes("data-active"))).toBe(true);
  });

  it("detects a text change", () => {
    const r = diff({ kind: "dom", before: node({}), after: node({ text: "Remove" }) });
    expect(r.summary.observableOutputChanged).toBe(true);
  });

  it("detects added/removed children", () => {
    const withChild = node({ children: [{ nodeName: "SPAN", text: "x" }] });
    const r = diff({ kind: "dom", before: node({}), after: withChild });
    expect(r.summary.observableOutputChanged).toBe(true);
  });
});
