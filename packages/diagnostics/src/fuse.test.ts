import { describe, it, expect } from "vitest";
import { mergeStaticAndRuntime } from "./fuse.js";
import type { Diagnostic } from "./types.js";
import type { StaticFinding } from "./static.js";
import type { ComponentId } from "@react-lens/protocol";

const CID = 1 as ComponentId;

describe("mergeStaticAndRuntime", () => {
  it("promotes static findings to diagnostics with runtime impact", () => {
    const staticFindings: StaticFinding[] = [
      {
        ruleId: "inline-context-value",
        severity: "warn",
        title: "Context value is a fresh object each render",
        detail: "…",
        line: 10,
      },
    ];
    const merged = mergeStaticAndRuntime(staticFindings, [], {
      componentId: CID,
      selfTime: 12,
      renders: 20,
      suspiciousRenders: 8,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]!.ruleId).toBe("inline-context-value");
    expect(merged[0]!.impact).toBeGreaterThan(12);
    expect(merged[0]!.componentId).toBe(CID);
  });

  it("boosts matching runtime diagnostics when static confirms", () => {
    const runtime: Diagnostic[] = [
      {
        ruleId: "render-fanout",
        componentId: CID,
        severity: "suspicious",
        title: "Frequent renders",
        detail: "…",
        impact: 10,
      },
    ];
    const staticFindings: StaticFinding[] = [
      {
        ruleId: "render-fanout",
        severity: "warn",
        title: "Frequent renders",
        detail: "…",
      },
    ];
    const merged = mergeStaticAndRuntime(staticFindings, runtime, {
      componentId: CID,
      selfTime: 5,
      renders: 10,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]!.impact).toBeGreaterThan(10);
  });
});
