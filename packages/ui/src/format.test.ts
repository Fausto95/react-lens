import { describe, it, expect } from "vite-plus/test";
import { ms, timeAxis } from "./format.js";

describe("timeAxis — clock-style labels for timeline positions", () => {
  it("keeps sub-second positions in ms", () => {
    expect(timeAxis(0)).toBe("0ms");
    expect(timeAxis(205)).toBe("205ms");
    expect(timeAxis(999.4)).toBe("999ms");
  });
  it("switches to seconds at 1s", () => {
    expect(timeAxis(1000)).toBe("1.00s");
    expect(timeAxis(17919)).toBe("17.9s");
    expect(timeAxis(59900)).toBe("59.9s");
  });
  it("switches to minutes at 60s", () => {
    expect(timeAxis(60_000)).toBe("1:00");
    expect(timeAxis(105_400)).toBe("1:45");
    expect(timeAxis(3_600_000)).toBe("60:00");
  });
});

describe("ms — durations stay as-is", () => {
  it("formats durations in milliseconds", () => {
    expect(ms(0.5)).toBe("0.50ms");
    expect(ms(9.25)).toBe("9.3ms");
    expect(ms(74.2)).toBe("74.2ms");
    expect(ms(123.4)).toBe("123ms");
  });
});
