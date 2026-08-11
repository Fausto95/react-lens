import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import type { ComponentId, SourceLocation } from "@reactlens/protocol";
import {
  configureComponentLocator,
  locateComponentSource,
  clearLocatedSources,
} from "./sourceLocator.js";
import { configureSourceFetcher } from "./sourceResolver.js";

const id = (n: number) => n as unknown as ComponentId;

function inlineModule(map: object): string {
  return `compiled(0);\n//# sourceMappingURL=data:application/json;base64,${btoa(JSON.stringify(map))}`;
}

beforeEach(() => {
  configureComponentLocator(undefined);
  configureSourceFetcher(undefined);
  clearLocatedSources();
});

describe("locateComponentSource", () => {
  it("returns null when no locator is configured (dev-only mode)", async () => {
    expect(await locateComponentSource(id(1))).toBeNull();
  });

  it("symbolicates a compiled location into the original file and name", async () => {
    // "AAAAA" maps generated 1:0 → source 0, line 1, col 0, name 0.
    configureSourceFetcher(async () =>
      inlineModule({
        version: 3,
        sources: ["src/ProductCard.tsx"],
        names: ["ProductCard"],
        mappings: "AAAAA",
      }),
    );
    configureComponentLocator(async () => ({
      file: "https://app.dev/assets/index-abc.js",
      line: 1,
      column: 0,
    }));

    const located = await locateComponentSource(id(1));
    expect(located).not.toBeNull();
    expect(located!.compiled.file).toBe("https://app.dev/assets/index-abc.js");
    expect(located!.original).toEqual({
      file: "src/ProductCard.tsx",
      line: 1,
      column: 0,
      name: "ProductCard",
    });
    expect(located!.originalName).toBe("ProductCard");
  });

  it("keeps the compiled location when no sourcemap is reachable", async () => {
    configureSourceFetcher(async () => {
      throw new Error("404");
    });
    const compiled: SourceLocation = {
      file: "https://app.dev/assets/index-abc.js",
      line: 1,
      column: 4200,
    };
    configureComponentLocator(async () => compiled);

    const located = await locateComponentSource(id(2));
    expect(located).not.toBeNull();
    expect(located!.compiled).toEqual(compiled);
    expect(located!.original).toBeUndefined();
    expect(located!.originalName).toBeUndefined();
  });

  it("returns null when the page cannot locate the component", async () => {
    configureComponentLocator(async () => null);
    expect(await locateComponentSource(id(3))).toBeNull();
  });

  it("survives a locator that rejects", async () => {
    configureComponentLocator(async () => {
      throw new Error("port closed");
    });
    expect(await locateComponentSource(id(4))).toBeNull();
  });

  it("caches per component — repeat lookups do not re-ask the page", async () => {
    const locator = vi.fn(async () => ({
      file: "https://app.dev/assets/index-abc.js",
      line: 2,
      column: 1,
    }));
    configureComponentLocator(locator);
    await locateComponentSource(id(5));
    await locateComponentSource(id(5));
    expect(locator).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent lookups of the same component", async () => {
    const locator = vi.fn(
      () =>
        new Promise<SourceLocation>((resolve) =>
          setTimeout(() => resolve({ file: "https://app.dev/x.js", line: 1, column: 0 }), 10),
        ),
    );
    configureComponentLocator(locator);
    const [a, b] = await Promise.all([locateComponentSource(id(6)), locateComponentSource(id(6))]);
    expect(locator).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("reconfiguring the locator drops cached results", async () => {
    configureComponentLocator(async () => ({ file: "https://a.dev/one.js", line: 1, column: 0 }));
    expect((await locateComponentSource(id(7)))!.compiled.file).toBe("https://a.dev/one.js");
    configureComponentLocator(async () => ({ file: "https://a.dev/two.js", line: 1, column: 0 }));
    expect((await locateComponentSource(id(7)))!.compiled.file).toBe("https://a.dev/two.js");
  });
});
