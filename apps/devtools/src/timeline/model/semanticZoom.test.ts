import { describe, expect, it } from "vite-plus/test";
import { semanticZoomForPxPerMs } from "./semanticZoom.js";

describe("semantic timeline zoom", () => {
  it("progressively reveals interaction, render, and detail representations", () => {
    expect(semanticZoomForPxPerMs(4)).toBe("session");
    expect(semanticZoomForPxPerMs(16)).toBe("interactions");
    expect(semanticZoomForPxPerMs(60)).toBe("renders");
    expect(semanticZoomForPxPerMs(160)).toBe("details");
  });
});
