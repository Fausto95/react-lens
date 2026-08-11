import { describe, it, expect } from "vite-plus/test";
import { createSourceResolver } from "./resolver.js";
import type { SourceLocation } from "@reactlens/protocol";

function inlineModule(map: object): string {
  const b64 = btoa(JSON.stringify(map));
  return `compiled(0);\n//# sourceMappingURL=data:application/json;base64,${b64}`;
}

const loc = (file: string, line: number, column: number): SourceLocation => ({
  file,
  line,
  column,
});

describe("source resolver", () => {
  it("maps a compiled position to the original source via an inline map", async () => {
    // "AAAA" maps generated line 1, col 0 → source[0], orig line 1, col 0.
    const code = inlineModule({
      version: 3,
      sources: ["src/App.tsx"],
      names: [],
      mappings: "AAAA",
    });
    const resolver = createSourceResolver(async () => code);
    const out = await resolver.resolve(loc("/src/App.tsx", 1, 0));
    expect(out).toEqual({ file: "src/App.tsx", line: 1, column: 0 });
  });

  it("returns null when the module has no source map", async () => {
    const resolver = createSourceResolver(async () => "compiled(0);\n");
    expect(await resolver.resolve(loc("/x.js", 1, 0))).toBeNull();
  });

  it("returns null and caches on fetch failure", async () => {
    let calls = 0;
    const resolver = createSourceResolver(async () => {
      calls++;
      throw new Error("boom");
    });
    expect(await resolver.resolve(loc("/x.js", 1, 0))).toBeNull();
    await resolver.resolve(loc("/x.js", 2, 0));
    expect(calls).toBe(1); // cached the null map, no refetch
  });

  it("normalizes bundler-prefixed source paths", async () => {
    const code = inlineModule({
      version: 3,
      sources: ["/@fs/Users/me/proj/src/App.tsx"],
      names: [],
      mappings: "AAAA",
    });
    const resolver = createSourceResolver(async () => code);
    const out = await resolver.resolve(loc("/src/App.tsx", 1, 0));
    expect(out?.file).toBe("src/App.tsx");
  });

  it("picks sourcesContent by prefer path when a map has multiple sources", async () => {
    const code = inlineModule({
      version: 3,
      sources: ["src/Other.tsx", "src/App.tsx"],
      sourcesContent: ["other", "app-src"],
      names: [],
      mappings: "AAAA",
    });
    const resolver = createSourceResolver(async () => code);
    const src = await resolver.sourceContent("/bundle.js", "src/App.tsx");
    expect(src?.content).toBe("app-src");
    expect(src?.path).toBe("src/App.tsx");
  });
});
