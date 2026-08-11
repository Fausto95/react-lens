import { describe, it, expect } from "vite-plus/test";
import { RingBuffer } from "./ring-buffer.js";

describe("RingBuffer.at", () => {
  it("indexes oldest→newest before wrapping", () => {
    const buf = new RingBuffer<number>(4);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.at(0)).toBe(1);
    expect(buf.at(2)).toBe(3);
  });

  it("indexes oldest→newest after wrapping", () => {
    const buf = new RingBuffer<number>(3);
    for (const n of [1, 2, 3, 4, 5]) buf.push(n);
    expect(buf.toArray()).toEqual([3, 4, 5]);
    expect(buf.at(0)).toBe(3);
    expect(buf.at(1)).toBe(4);
    expect(buf.at(2)).toBe(5);
  });

  it("returns undefined out of range", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    expect(buf.at(-1)).toBeUndefined();
    expect(buf.at(1)).toBeUndefined();
  });

  it("agrees with toArray at every index", () => {
    const buf = new RingBuffer<number>(7);
    for (let n = 0; n < 23; n++) buf.push(n);
    const arr = buf.toArray();
    for (let i = 0; i < buf.size; i++) expect(buf.at(i)).toBe(arr[i]);
  });
});
