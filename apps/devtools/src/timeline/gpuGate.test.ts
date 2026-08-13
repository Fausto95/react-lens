import { describe, expect, it } from "vite-plus/test";
import { preferWorkerPaint } from "./gpuGate.js";

describe("preferWorkerPaint", () => {
  it("requires OffscreenCanvas availability", () => {
    expect(
      preferWorkerPaint({ clipEstimate: 100, hasGeometry: true, offscreenAvailable: false }),
    ).toBe(false);
  });

  it("prefers worker when transferable geometry is present", () => {
    expect(
      preferWorkerPaint({ clipEstimate: 100_000, hasGeometry: true, offscreenAvailable: true }),
    ).toBe(true);
  });

  it("falls back to main thread for huge layouts without geometry", () => {
    expect(
      preferWorkerPaint({ clipEstimate: 50_000, hasGeometry: false, offscreenAvailable: true }),
    ).toBe(false);
  });
});
