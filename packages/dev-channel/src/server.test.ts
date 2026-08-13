import { describe, it, expect, afterAll } from "vite-plus/test";
import WebSocket from "ws";
import { createDevChannelServer } from "./server.js";

describe("dev-channel", () => {
  const port = 19235;
  let server: Awaited<ReturnType<typeof createDevChannelServer>>;

  afterAll(async () => {
    if (server) await server.close();
  });

  it("accepts connection, receives frames, ack is independent", async () => {
    server = await createDevChannelServer({ port });
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const timer = setTimeout(() => reject(new Error("timeout")), 3000);
      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            type: "frame",
            seq: 1,
            payload: { events: [], snapshots: [], instances: [] },
          }),
        );
        ws.send(JSON.stringify({ type: "ack", seq: 1 }));
        ws.close();
      });
      ws.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    expect(server.received().length).toBeGreaterThanOrEqual(1);
    expect(server.received()[0]?.seq).toBe(1);
  });
});
