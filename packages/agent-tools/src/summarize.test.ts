import { describe, it, expect } from "vite-plus/test";
import type { SerializedValue } from "@reactlens/protocol";
import { summarizeValue } from "./summarize.js";

const num = (value: number): SerializedValue => ({ k: "primitive", type: "number", value });
const str = (value: string): SerializedValue => ({ k: "primitive", type: "string", value });
const obj = (identity: string, entries: Array<[string, SerializedValue]>): SerializedValue => ({
  k: "object",
  identity,
  entries,
});

describe("summarizeValue", () => {
  it("passes primitives through as type + preview", () => {
    expect(summarizeValue(num(42))).toEqual({ type: "number", preview: "42" });
    expect(summarizeValue({ k: "primitive", type: "boolean", value: true })).toEqual({
      type: "boolean",
      preview: "true",
    });
    expect(summarizeValue({ k: "null" })).toEqual({ type: "null" });
    expect(summarizeValue({ k: "undefined" })).toEqual({ type: "undefined" });
  });

  it("truncates long strings to a preview and keeps the original length", () => {
    const long = "x".repeat(300);
    const out = summarizeValue(str(long));
    expect(out.type).toBe("string");
    expect(out.preview!.length).toBeLessThanOrEqual(81); // 80 chars + ellipsis
    expect(out.size).toBe(300);
    expect(out.truncated).toBe(true);
    // Short strings stay whole, without truncation noise.
    expect(summarizeValue(str("hi"))).toEqual({ type: "string", preview: "hi" });
  });

  it("summarizes functions with their name and reference identity", () => {
    const out = summarizeValue({ k: "function", identity: "f1", name: "onSelect" });
    expect(out).toEqual({ type: "function", preview: "ƒ onSelect", identity: "f1" });
  });

  it("caps array items and reports the true length", () => {
    const arr: SerializedValue = {
      k: "array",
      identity: "a1",
      length: 10,
      items: Array.from({ length: 10 }, (_, i) => num(i)),
    };
    const out = summarizeValue(arr);
    expect(out).toMatchObject({ type: "array", size: 10, identity: "a1", truncated: true });
    expect(out.items).toHaveLength(5);
    expect(out.items![0]).toEqual({ type: "number", preview: "0" });
  });

  it("reports length even for arrays serialized without items", () => {
    const out = summarizeValue({ k: "array", identity: "a2", length: 5000 });
    expect(out).toMatchObject({ type: "array", size: 5000 });
    expect(out.items).toBeUndefined();
  });

  it("stops expanding at the depth limit but keeps type and size", () => {
    const deep = obj("o1", [["a", obj("o2", [["b", obj("o3", [["c", num(1)]])]])]]);
    const out = summarizeValue(deep); // default depth 2
    const a = out.entries!.a!;
    const b = a.entries!.b!;
    expect(b).toMatchObject({ type: "object", size: 1, truncated: true });
    expect(b.entries).toBeUndefined();
  });

  it("caps object entries and reports the true key count", () => {
    const wide = obj(
      "o1",
      Array.from({ length: 20 }, (_, i) => [`k${i}`, num(i)] as [string, SerializedValue]),
    );
    const out = summarizeValue(wide);
    expect(out.size).toBe(20);
    expect(Object.keys(out.entries!)).toHaveLength(12);
    expect(out.truncated).toBe(true);
  });

  it("summarizes maps and sets by size without expanding", () => {
    expect(summarizeValue({ k: "map", identity: "m1", size: 7 })).toMatchObject({
      type: "map",
      size: 7,
    });
    expect(summarizeValue({ k: "set", identity: "s1", size: 3 })).toMatchObject({
      type: "set",
      size: 3,
    });
  });

  it("degrades unknown shapes to opaque instead of throwing", () => {
    expect(summarizeValue({ k: "unserializable", reason: "circular" })).toEqual({
      type: "opaque",
      preview: "circular",
    });
    expect(summarizeValue({ k: "react-element", identity: "e1", typeName: "Card" })).toEqual({
      type: "react-element",
      preview: "<Card>",
      identity: "e1",
    });
  });
});
