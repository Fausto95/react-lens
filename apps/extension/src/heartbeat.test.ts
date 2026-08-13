import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { createHeartbeat, HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from "./heartbeat.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("port heartbeat", () => {
  it("pings on an interval while the peer answers", () => {
    const sent: number[] = [];
    const beat = createHeartbeat({
      send: (id) => sent.push(id),
      onDead: () => {
        throw new Error("should not be declared dead");
      },
    });

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(sent).toHaveLength(1);
    beat.pong(sent[0]!);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(sent).toHaveLength(2);
    beat.pong(sent[1]!);
    beat.stop();
  });

  it("declares the port dead when a ping goes unanswered", () => {
    // A half-open port is the failure no `onDisconnect` handler ever sees: the
    // panel looks connected and simply stops receiving the session.
    let dead = 0;
    const beat = createHeartbeat({ send: () => {}, onDead: () => dead++ });

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS);
    expect(dead).toBe(1);
    beat.stop();
  });

  it("declares death once, not once per missed ping", () => {
    let dead = 0;
    const beat = createHeartbeat({ send: () => {}, onDead: () => dead++ });

    vi.advanceTimersByTime((HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS) * 4);
    expect(dead).toBe(1);
    beat.stop();
  });

  it("ignores a pong for a ping it is not waiting on", () => {
    // A pong left over from a previous port must not keep a dead one alive.
    let dead = 0;
    const sent: number[] = [];
    const beat = createHeartbeat({ send: (id) => sent.push(id), onDead: () => dead++ });

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    beat.pong(sent[0]! + 999);
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);

    expect(dead).toBe(1);
    beat.stop();
  });

  it("reports the peer as proven only after a pong", () => {
    // The panel resets its reconnect backoff on this, not on `connect()`
    // returning — a port that dies immediately must not reset the delay.
    const sent: number[] = [];
    const beat = createHeartbeat({ send: (id) => sent.push(id), onDead: () => {} });

    expect(beat.proven()).toBe(false);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    beat.pong(sent[0]!);
    expect(beat.proven()).toBe(true);
    beat.stop();
  });

  it("stops pinging once disposed", () => {
    const sent: number[] = [];
    const beat = createHeartbeat({ send: (id) => sent.push(id), onDead: () => {} });
    beat.stop();

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    expect(sent).toEqual([]);
  });
});
