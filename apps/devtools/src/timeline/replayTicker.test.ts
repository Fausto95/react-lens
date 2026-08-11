import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { startReplayTicker, FRAME_DELTA_CAP_MS } from "./replayTicker.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let rafQueue: FrameRequestCallback[] = [];
function flushRaf(): void {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(performance.now());
}

function stubRaf(): void {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startReplayTicker — hidden-tab scheduling", () => {
  it("reaches the end via the timer fallback when rAF never fires", async () => {
    // Hidden/backgrounded documents pause requestAnimationFrame entirely; the
    // replay must keep advancing (the controller already has this guarantee).
    stubRaf();
    const ticks: Array<{ frac: number; done: boolean }> = [];
    const ticker = startReplayTicker(120, false, (frac, done) => ticks.push({ frac, done }));
    await sleep(600);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.at(-1)).toMatchObject({ frac: 1, done: true });
    const fracs = ticks.map((t) => t.frac);
    expect([...fracs].sort((a, b) => a - b)).toEqual(fracs);
    ticker.stop();
  });

  it("does not double-tick when both rAF and the fallback fire", async () => {
    stubRaf();
    const ticks: number[] = [];
    const ticker = startReplayTicker(10_000, false, (frac) => ticks.push(frac));
    flushRaf(); // rAF wins the frame — the armed fallback must be disarmed
    await sleep(40); // shorter than the fallback interval: no second tick
    expect(ticks).toHaveLength(1);
    ticker.stop();
  });

  it("a stalled frame pauses playback instead of skipping ahead", () => {
    stubRaf();
    let fakeNow = 0;
    const ticks: Array<{ frac: number; done: boolean }> = [];
    const ticker = startReplayTicker(
      700,
      false,
      (frac, done) => ticks.push({ frac, done }),
      () => fakeNow,
    );
    fakeNow = 5000; // a 5s gap between frames (hidden tab, heavy apply)
    flushRaf();
    expect(ticks.at(-1)!.frac).toBeCloseTo(FRAME_DELTA_CAP_MS / 700);
    expect(ticks.at(-1)!.done).toBe(false);
    ticker.stop();
  });

  it("stop() cancels both schedulers", async () => {
    stubRaf();
    const ticks: number[] = [];
    const ticker = startReplayTicker(120, false, (frac) => ticks.push(frac));
    ticker.stop();
    flushRaf();
    await sleep(250);
    expect(ticks).toHaveLength(0);
  });

  it("loops back to zero instead of finishing when loop is set", () => {
    stubRaf();
    let fakeNow = 0;
    const ticks: Array<{ frac: number; done: boolean }> = [];
    const ticker = startReplayTicker(
      100,
      true,
      (frac, done) => ticks.push({ frac, done }),
      () => fakeNow,
    );
    for (let i = 0; i < 3; i++) {
      fakeNow += 100;
      flushRaf();
    }
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((t) => !t.done)).toBe(true);
    expect(ticks.some((t) => t.frac === 0)).toBe(true);
    ticker.stop();
  });
});
