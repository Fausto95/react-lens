import { describe, it, expect } from "vitest";
import { analyzeSource, definitionLine, definitionSpan } from "./static.js";

describe("analyzeSource — static rules", () => {
  it("flags an inline context value", () => {
    const src = `
      function Shop() {
        return <Ctx.Provider value={{ a, b }}>{children}</Ctx.Provider>;
      }
    `;
    const f = analyzeSource(src).find((x) => x.ruleId === "inline-context-value");
    expect(f).toBeDefined();
    expect(f?.line).toBe(3);
  });

  it("flags an effect that derives state", () => {
    const src = [
      "function C() {",
      "  useEffect(() => setFullName(first + last), [first, last]);",
      "  return null;",
      "}",
    ].join("\n");
    const f = analyzeSource(src).find((x) => x.ruleId === "effect-derives-state");
    expect(f).toBeDefined();
    expect(f?.line).toBe(2);
  });

  it("stays quiet on clean source", () => {
    const src = `function C() { const v = useMemo(() => ({ a }), [a]); return <Ctx.Provider value={v} />; }`;
    expect(analyzeSource(src)).toHaveLength(0);
  });

  it("scopes findings to the named component's definition", () => {
    const src = [
      "function Clean() {",
      "  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;",
      "}",
      "function Dirty() {",
      "  return <Ctx.Provider value={{ a }}>{children}</Ctx.Provider>;",
      "}",
    ].join("\n");
    expect(analyzeSource(src, { name: "Clean" })).toHaveLength(0);
    const dirty = analyzeSource(src, { name: "Dirty", file: "src/App.tsx" });
    expect(dirty).toHaveLength(1);
    expect(dirty[0]?.source).toEqual({ file: "src/App.tsx", line: 5, column: 0 });
  });
});

describe("definitionLine", () => {
  const src = ["import x;", "", "function ProductCard(props) {", "  return null;", "}"].join("\n");

  it("finds a function declaration", () => {
    expect(definitionLine(src, "ProductCard")).toBe(3);
  });
  it("finds arrow/const components", () => {
    expect(definitionLine("const Cart = () => null", "Cart")).toBe(1);
  });
  it("returns undefined when absent", () => {
    expect(definitionLine(src, "Nope")).toBeUndefined();
  });
});

describe("definitionSpan", () => {
  it("covers a braced function body", () => {
    const src = [
      "function Outer() {",
      "  return null;",
      "}",
      "function Inner() {",
      "  useEffect(() => setX(1));",
      "  return null;",
      "}",
    ].join("\n");
    expect(definitionSpan(src, "Inner")).toEqual({ startLine: 4, endLine: 7 });
  });
});
