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

function latest(
  over: Partial<NonNullable<DiagnosticInput["latest"]>> = {},
): NonNullable<DiagnosticInput["latest"]> {
  return {
    wasted: false,
    identityKeys: [],
    compilerBailout: null,
    contextUpdate: false,
    parentOnly: false,
    externalStore: false,
    forceUpdate: false,
    effectMs: 0,
    renderMs: 1,
    cascadeSize: 0,
    reasonSummary: "props changed: items",
    ownValueChanged: false,
    effectLines: [],
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

describe("wasted-render rule", () => {
  it("fires on a wasted latest render and names the next step", () => {
    const d = analyzeOne(input({ latest: latest({ wasted: true, cascadeSize: 3 }) }));
    const found = d.find((x) => x.ruleId === "wasted-render");
    expect(found?.severity).toBe("severe");
    expect(found?.fix).toMatch(/stop at its source/);
    expect(found?.detail).toMatch(/3 downstream/);
  });

  it("stays quiet without latest evidence", () => {
    expect(analyzeOne(input({})).find((x) => x.ruleId === "wasted-render")).toBeUndefined();
  });
});

describe("identity-churn rule", () => {
  it("fires when structurally equal values have new references", () => {
    const d = analyzeOne(input({ latest: latest({ identityKeys: ["items"] }) }));
    const found = d.find((x) => x.ruleId === "identity-churn");
    expect(found).toBeDefined();
    expect(found?.detail).toMatch(/items is referentially new/);
    expect(found?.fix).toMatch(/Stabilize/);
  });
});

describe("compiler-bailout rule", () => {
  it("surfaces the captured bailout reason before suggesting memoization", () => {
    const d = analyzeOne(
      input({ latest: latest({ compilerBailout: "useRef value mutated during render" }) }),
    );
    const found = d.find((x) => x.ruleId === "compiler-bailout");
    expect(found?.detail).toMatch(/useRef value mutated/);
    expect(found?.fix).toMatch(/before adding manual memoization/);
  });
});

describe("context-fanout rule", () => {
  it("fires only when a context update has meaningful downstream fan-out", () => {
    expect(
      analyzeOne(input({ latest: latest({ contextUpdate: true, cascadeSize: 1 }) })).find(
        (x) => x.ruleId === "context-fanout",
      ),
    ).toBeUndefined();
    const found = analyzeOne(
      input({ latest: latest({ contextUpdate: true, cascadeSize: 4 }) }),
    ).find((x) => x.ruleId === "context-fanout");
    expect(found?.title).toMatch(/4 downstream/);
  });
});

describe("parent-cascade rule", () => {
  it("fires when a parent woke the component without its own changes", () => {
    const found = analyzeOne(input({ latest: latest({ parentOnly: true }) })).find(
      (x) => x.ruleId === "parent-cascade",
    );
    expect(found?.severity).toBe("info");
    expect(found?.fix).toMatch(/parent boundary/);
  });

  it("does not fire when the parent-only render was also wasted", () => {
    expect(
      analyzeOne(input({ latest: latest({ parentOnly: true, wasted: true }) })).find(
        (x) => x.ruleId === "parent-cascade",
      ),
    ).toBeUndefined();
  });
});

describe("external-store rule", () => {
  it("fires on an external-store invalidation", () => {
    const found = analyzeOne(input({ latest: latest({ externalStore: true }) })).find(
      (x) => x.ruleId === "external-store",
    );
    expect(found?.fix).toMatch(/selector granularity/);
  });
});

describe("force-update rule", () => {
  it("fires when change detection was bypassed", () => {
    const found = analyzeOne(input({ latest: latest({ forceUpdate: true }) })).find(
      (x) => x.ruleId === "force-update",
    );
    expect(found?.severity).toBe("severe");
    expect(found?.fix).toMatch(/forceUpdate caller/);
  });
});

describe("effect-heavy rule", () => {
  it("fires when effect work is material relative to the render", () => {
    const found = analyzeOne(
      input({
        latest: latest({
          effectMs: 4,
          renderMs: 1,
          effectLines: ["run · hook #2 · 4.0ms"],
        }),
      }),
    ).find((x) => x.ruleId === "effect-heavy");
    expect(found?.title).toMatch(/4\.0ms/);
    expect(found?.detail).toMatch(/hook #2/);
  });

  it("stays quiet for tiny effects", () => {
    expect(
      analyzeOne(input({ latest: latest({ effectMs: 0.2, renderMs: 1 }) })).find(
        (x) => x.ruleId === "effect-heavy",
      ),
    ).toBeUndefined();
  });
});
