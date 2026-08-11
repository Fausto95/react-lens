import { describe, it, expect } from "vitest";
import { fuzzyScore } from "./fuzzy.js";

describe("fuzzyScore", () => {
  it("null when the query is not a subsequence", () => {
    expect(fuzzyScore("xyz", "ProductCard")).toBeNull();
  });

  it("empty query matches everything at score 0", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("matches subsequences case-insensitively", () => {
    expect(fuzzyScore("pcard", "ProductCard")).not.toBeNull();
    expect(fuzzyScore("PCARD", "productcard")).not.toBeNull();
  });

  it("ranks word-boundary and consecutive matches above scattered ones", () => {
    const boundary = fuzzyScore("pc", "ProductCard")!; // P + C at word starts
    const scattered = fuzzyScore("pc", "Speck")!; // p, c mid-word
    expect(boundary).toBeGreaterThan(scattered);

    const consecutive = fuzzyScore("card", "ProductCard")!;
    const spread = fuzzyScore("card", "CoolArrowDial")!;
    expect(consecutive).toBeGreaterThan(spread);
  });

  it("prefers matches near the start of the text", () => {
    expect(fuzzyScore("go", "Go live")!).toBeGreaterThan(fuzzyScore("go", "Session · go")!);
  });
});
