import { describe, it, expect } from "vite-plus/test";
import { analyze, analyzeOne } from "./rules.js";
import type { DiagnosticInput } from "./types.js";
import type { ComponentId } from "@reactlens/protocol";

function input(over: Partial<DiagnosticInput>): DiagnosticInput {
  return {
    componentId: 1 as ComponentId,
    name: "ProductCard",
    renders: 10,
    suspiciousRenders: 0,
    selfTime: 5,
    functionPropChurn: false,
    uncompiled: false,
    ...over,
  };
}

describe("render-fanout rule", () => {
  it("fires when most renders produce no observable change", () => {
    const d = analyzeOne(input({ renders: 10, suspiciousRenders: 9 }));
    expect(d.find((x) => x.ruleId === "render-fanout")?.severity).toBe("severe");
  });

  it("does not fire below the render threshold", () => {
    expect(analyzeOne(input({ renders: 2, suspiciousRenders: 2 }))).toHaveLength(0);
  });

  it("does not fire when renders were mostly meaningful", () => {
    const d = analyzeOne(input({ renders: 10, suspiciousRenders: 2 }));
    expect(d.find((x) => x.ruleId === "render-fanout")).toBeUndefined();
  });
});

describe("unstable-callback rule", () => {
  it("fires on function-prop churn and notes compiler status", () => {
    const d = analyzeOne(input({ functionPropChurn: true, uncompiled: true }));
    const found = d.find((x) => x.ruleId === "unstable-callback");
    expect(found).toBeDefined();
    expect(found?.detail).toMatch(/not compiled/);
  });

  it("stays quiet without churn", () => {
    expect(analyzeOne(input({ functionPropChurn: false }))).toHaveLength(0);
  });
});

describe("analyze — ranking", () => {
  it("ranks higher-impact diagnostics first", () => {
    const all = analyze([
      input({ componentId: 1 as ComponentId, renders: 10, suspiciousRenders: 9, selfTime: 40 }),
      input({ componentId: 2 as ComponentId, renders: 5, suspiciousRenders: 4, selfTime: 1 }),
    ]);
    expect(all[0]!.impact).toBeGreaterThanOrEqual(all[all.length - 1]!.impact);
    expect(all[0]!.componentId).toBe(1);
  });
});
