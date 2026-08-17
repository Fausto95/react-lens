import { describe, expect, it } from "vite-plus/test";
import type { EventsBatchMessage } from "@reactlens/protocol";
import { createDoctorClient, type DoctorSpawn } from "./doctorClient.js";

/** A Worker stand-in that records what it was sent and can reply or fail. */
function fakeWorker() {
  const posted: unknown[] = [];
  let terminated = false;
  const w = {
    posted,
    get terminated() {
      return terminated;
    },
    onmessage: null as ((e: { data: unknown }) => void) | null,
    onerror: null as ((e: unknown) => void) | null,
    postMessage(msg: unknown) {
      if (terminated) throw new Error("postMessage on a terminated worker");
      posted.push(msg);
    },
    terminate() {
      terminated = true;
    },
    reply(data: unknown) {
      w.onmessage?.({ data });
    },
    fail(message: string) {
      w.onerror?.({ message });
    },
  };
  return w;
}

const emptyBatch = { instances: [], events: [] } as unknown as EventsBatchMessage["payload"];

describe("createDoctorClient", () => {
  it("forwards worker results to subscribers", () => {
    const w = fakeWorker();
    const client = createDoctorClient({ spawn: (() => w) as unknown as DoctorSpawn })!;
    const seen: number[] = [];
    client.subscribe((r) => seen.push(r.count));
    w.reply({ count: 3, affected: [1, 2], diagnostics: [] });
    expect(seen).toEqual([3]);
  });

  it("ignores source-map resolve replies", () => {
    const w = fakeWorker();
    const client = createDoctorClient({ spawn: (() => w) as unknown as DoctorSpawn })!;
    let calls = 0;
    client.subscribe(() => calls++);
    w.reply({ type: "resolve-result", requestId: "r1", location: null });
    expect(calls).toBe(0);
  });

  it("reports a worker that dies after construction", () => {
    // The whole class of bug this guards: `new Worker` succeeds and the script
    // fails later, so a silent client would report "no issues" forever.
    const w = fakeWorker();
    const failures: string[] = [];
    const client = createDoctorClient({
      spawn: (() => w) as unknown as DoctorSpawn,
      onError: (err) => failures.push(String(err)),
    })!;
    expect(client).not.toBeNull();
    w.fail("boom");
    expect(failures).toHaveLength(1);
  });

  it("returns null when the worker cannot be constructed", () => {
    const client = createDoctorClient({
      spawn: (() => {
        throw new Error("no workers here");
      }) as unknown as DoctorSpawn,
    });
    expect(client).toBeNull();
  });

  it("dispose terminates the worker and later ingests are inert", () => {
    // Ownership: whoever disposes must be the one that created it. A disposed
    // client that still accepts ingests would look alive while being dead —
    // exactly what left the embedded panel's Doctor permanently empty.
    const w = fakeWorker();
    const client = createDoctorClient({ spawn: (() => w) as unknown as DoctorSpawn })!;
    client.ingest(emptyBatch);
    expect(w.posted).toHaveLength(1);

    client.dispose();
    expect(w.terminated).toBe(true);
    expect(() => client.ingest(emptyBatch)).not.toThrow();
    expect(w.posted).toHaveLength(1);
  });

  it("a disposed client stops delivering results", () => {
    const w = fakeWorker();
    const client = createDoctorClient({ spawn: (() => w) as unknown as DoctorSpawn })!;
    let calls = 0;
    client.subscribe(() => calls++);
    client.dispose();
    w.reply({ count: 9, affected: [1], diagnostics: [] });
    expect(calls).toBe(0);
  });
});
