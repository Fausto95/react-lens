import type { EventsBatchMessage } from "@reactlens/protocol";
import { WebSocketServer, WebSocket } from "ws";

export interface DevChannelFrame {
  seq: number;
  payload: EventsBatchMessage["payload"];
}

export interface DevChannelServer {
  port: number;
  close(): Promise<void>;
  received(): readonly DevChannelFrame[];
}

export interface DevChannelClient {
  send(frame: DevChannelFrame): void;
  ack(seq: number): void;
  close(): void;
}

const MAX_BUFFER = 64;

export function createDevChannelServer(opts: { port: number }): Promise<DevChannelServer> {
  const received: DevChannelFrame[] = [];
  const wss = new WebSocketServer({ port: opts.port });

  wss.on("connection", (ws) => {
    const queue: DevChannelFrame[] = [];
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data)) as { type: string; seq?: number };
        if (msg.type === "ack" && typeof msg.seq === "number") {
          /* ack is independent — server does not block on it */
          return;
        }
        if (msg.type === "frame" && "payload" in msg && typeof msg.seq === "number") {
          const frame = msg as DevChannelFrame & { type: "frame" };
          received.push({ seq: frame.seq, payload: frame.payload });
          queue.push({ seq: frame.seq, payload: frame.payload });
          if (queue.length > MAX_BUFFER) queue.shift();
        }
      } catch {
        /* ignore malformed */
      }
    });
  });

  return Promise.resolve({
    port: opts.port,
    received: () => received,
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.close();
        wss.close(() => resolve());
      }),
  });
}

export function createDevChannelClient(url: string): DevChannelClient {
  const ws = new WebSocket(url);
  return {
    send(frame) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "frame", ...frame }));
      }
    },
    ack(seq) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ack", seq }));
      }
    },
    close() {
      ws.close();
    },
  };
}

/**
 * Non-blocking sink: copy frames to a dev channel without modifying capture hot path.
 * Wrap an existing onFrame — the original callback runs first; channel post is best-effort.
 */
export function attachDevChannelSink(
  onFrame: (frame: EventsBatchMessage["payload"]) => void,
  client: DevChannelClient,
): (frame: EventsBatchMessage["payload"]) => void {
  let seq = 0;
  return (frame) => {
    onFrame(frame);
    try {
      client.send({ seq: ++seq, payload: frame });
    } catch {
      /* never block capture */
    }
  };
}
