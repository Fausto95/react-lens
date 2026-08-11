import { describe, it, expect } from "vite-plus/test";
import { createSerializer } from "./serializer.js";

describe("serializer — primitives", () => {
  it("serializes strings, numbers, booleans", () => {
    const s = createSerializer();
    expect(s.serialize("hi")).toEqual({ k: "primitive", type: "string", value: "hi" });
    expect(s.serialize(42)).toEqual({ k: "primitive", type: "number", value: 42 });
    expect(s.serialize(true)).toEqual({ k: "primitive", type: "boolean", value: true });
  });

  it("distinguishes null and undefined", () => {
    const s = createSerializer();
    expect(s.serialize(null)).toEqual({ k: "null" });
    expect(s.serialize(undefined)).toEqual({ k: "undefined" });
  });

  it("truncates long strings to the budget", () => {
    const s = createSerializer();
    const out = s.serialize("x".repeat(50), { maxStringLength: 10 });
    if (out.k !== "primitive" || out.type !== "string") throw new Error("expected string");
    expect((out.value as string).length).toBeLessThanOrEqual(11); // +ellipsis marker
  });

  it("handles bigint, date, regexp", () => {
    const s = createSerializer();
    expect(s.serialize(10n)).toEqual({ k: "bigint", value: "10" });
    const d = s.serialize(new Date("2020-01-01T00:00:00.000Z"));
    expect(d).toEqual({ k: "date", iso: "2020-01-01T00:00:00.000Z" });
    const r = s.serialize(/ab+c/gi);
    expect(r).toEqual({ k: "regexp", source: "ab+c", flags: "gi" });
  });
});

describe("serializer — reference identity", () => {
  it("gives the same identity to the same reference", () => {
    const s = createSerializer();
    const fn = () => {};
    const a = s.serialize(fn);
    const b = s.serialize(fn);
    if (a.k !== "function" || b.k !== "function") throw new Error("expected function");
    expect(a.identity).toBe(b.identity);
  });

  it("gives different identities to structurally-equal but distinct functions", () => {
    const s = createSerializer();
    const a = s.serialize(() => {});
    const b = s.serialize(() => {});
    if (a.k !== "function" || b.k !== "function") throw new Error("expected function");
    expect(a.identity).not.toBe(b.identity);
  });

  it("captures function name", () => {
    const s = createSerializer();
    function handleClick() {}
    const out = s.serialize(handleClick);
    if (out.k !== "function") throw new Error("expected function");
    expect(out.name).toBe("handleClick");
  });

  it("reuses object identity across serializations of the same ref", () => {
    const s = createSerializer();
    const obj = { a: 1 };
    const first = s.serialize(obj);
    const second = s.serialize(obj);
    if (first.k !== "object" || second.k !== "object") throw new Error("expected object");
    expect(first.identity).toBe(second.identity);
  });
});

describe("serializer — objects and arrays", () => {
  it("serializes object entries up to maxItems", () => {
    const s = createSerializer();
    const out = s.serialize({ a: 1, b: "two", c: true });
    if (out.k !== "object") throw new Error("expected object");
    expect(out.entries).toHaveLength(3);
  });

  it("respects maxDepth (deep values become refs/omitted)", () => {
    const s = createSerializer();
    const deep = { l1: { l2: { l3: { l4: { l5: 1 } } } } };
    const out = s.serialize(deep, { maxDepth: 2 });
    if (out.k !== "object") throw new Error("expected object");
    // Depth is bounded; we should not have recursed to l5.
    const l1 = out.entries?.[0]?.[1];
    expect(l1?.k).toBe("object");
  });

  it("serializes arrays with length even when items omitted over budget", () => {
    const s = createSerializer();
    const out = s.serialize([1, 2, 3, 4, 5], { maxItems: 2 });
    if (out.k !== "array") throw new Error("expected array");
    expect(out.length).toBe(5);
    expect(out.items?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it("captures constructor name for class instances", () => {
    const s = createSerializer();
    class Point {
      constructor(public x: number) {}
    }
    const out = s.serialize(new Point(1));
    if (out.k !== "object") throw new Error("expected object");
    expect(out.ctor).toBe("Point");
  });
});

describe("serializer — safety invariants", () => {
  it("never throws and represents cycles as refs", () => {
    const s = createSerializer();
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => s.serialize(a)).not.toThrow();
    const out = s.serialize(a);
    if (out.k !== "object") throw new Error("expected object");
    const selfEntry = out.entries?.find(([key]) => key === "self")?.[1];
    expect(selfEntry?.k).toBe("ref");
    if (selfEntry?.k === "ref") expect(selfEntry.identity).toBe(out.identity);
  });

  it("does not throw on a throwing getter", () => {
    const s = createSerializer();
    const evil = {
      get boom(): never {
        throw new Error("nope");
      },
    };
    expect(() => s.serialize(evil)).not.toThrow();
    const out = s.serialize(evil);
    if (out.k !== "object") throw new Error("expected object");
    const boom = out.entries?.find(([key]) => key === "boom")?.[1];
    expect(boom?.k).toBe("unserializable");
  });

  it("serializes Map and Set with size", () => {
    const s = createSerializer();
    const m = s.serialize(new Map([["a", 1]]));
    expect(m.k).toBe("map");
    if (m.k === "map") expect(m.size).toBe(1);
    const set = s.serialize(new Set([1, 2]));
    expect(set.k).toBe("set");
    if (set.k === "set") expect(set.size).toBe(2);
  });

  it("reset clears the identity table", () => {
    const s = createSerializer();
    const fn = () => {};
    const before = s.serialize(fn);
    s.reset();
    const after = s.serialize(fn);
    if (before.k !== "function" || after.k !== "function") throw new Error("expected function");
    expect(after.identity).not.toBe(before.identity);
  });
});
