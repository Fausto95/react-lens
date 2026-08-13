import { describe, it, expect } from "vite-plus/test";
import { analyzeSourceAst } from "./ast-node.js";

describe("analyzeSourceAst", () => {
  it("flags inline Provider value via JSX AST", () => {
    const src = `
      function Shop() {
        return <Ctx.Provider value={{ a, b }}>{children}</Ctx.Provider>;
      }
    `;
    const f = analyzeSourceAst(src, { name: "Shop", file: "Shop.tsx" });
    expect(f.some((x) => x.ruleId === "inline-context-value")).toBe(true);
    expect(f[0]?.source?.file).toBe("Shop.tsx");
  });

  it("flags effect that derives state (expression body)", () => {
    const src = [
      "function C() {",
      "  useEffect(() => setFullName(first + last), [first, last]);",
      "  return null;",
      "}",
    ].join("\n");
    const f = analyzeSourceAst(src, { name: "C" });
    expect(f.some((x) => x.ruleId === "effect-derives-state")).toBe(true);
  });

  it("flags effect that derives state (block body)", () => {
    const src = [
      "function C() {",
      "  useEffect(() => {",
      "    setFullName(first + last);",
      "  }, [first, last]);",
      "  return null;",
      "}",
    ].join("\n");
    const f = analyzeSourceAst(src, { name: "C" });
    expect(f.some((x) => x.ruleId === "effect-derives-state")).toBe(true);
  });

  it("scopes to the named component", () => {
    const src = [
      "function Clean() {",
      "  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;",
      "}",
      "function Dirty() {",
      "  return <Ctx.Provider value={{ a }}>{children}</Ctx.Provider>;",
      "}",
    ].join("\n");
    expect(analyzeSourceAst(src, { name: "Clean" })).toHaveLength(0);
    expect(analyzeSourceAst(src, { name: "Dirty" })).toHaveLength(1);
  });
});
