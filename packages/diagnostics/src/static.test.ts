import { describe, it, expect } from "vitest";
import { analyzeSource, definitionLine } from "./static.js";

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
