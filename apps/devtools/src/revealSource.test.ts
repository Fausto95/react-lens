import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { configureSourceRevealer, revealSource } from "./revealSource.js";

beforeEach(() => {
  configureSourceRevealer(undefined);
});

describe("revealSource", () => {
  it("prefers a configured revealer (the extension's Sources panel)", async () => {
    const reveal = vi.fn(async () => true);
    configureSourceRevealer(reveal);
    const ok = await revealSource(
      { file: "https://app.dev/assets/index-abc.js", line: 1, column: 5 },
      null,
    );
    expect(ok).toBe(true);
    expect(reveal).toHaveBeenCalledWith("https://app.dev/assets/index-abc.js", 1, 5);
  });

  it("reveals the ORIGINAL path when one resolved — browsers apply maps too", async () => {
    const reveal = vi.fn(async () => true);
    configureSourceRevealer(reveal);
    await revealSource(
      { file: "https://app.dev/assets/index-abc.js", line: 1, column: 5 },
      { file: "src/ProductCard.tsx", line: 12, column: 2 },
    );
    expect(reveal).toHaveBeenCalledWith("src/ProductCard.tsx", 12, 2);
  });

  it("falls back to the editor when no revealer is configured (embedded)", async () => {
    // No revealer: embedded panels open the local editor instead.
    const ok = await revealSource({ file: "  ", line: 1, column: 1 }, null);
    expect(ok).toBe(false); // an unusable path reaches neither path
  });

  it("falls back to the editor when the revealer declines", async () => {
    configureSourceRevealer(async () => false);
    // A dev-server URL still opens through the editor middleware path.
    const ok = await revealSource(
      { file: "http://localhost:5173/src/App.tsx", line: 3, column: 1 },
      null,
    );
    expect(ok).toBe(true);
  });
});
