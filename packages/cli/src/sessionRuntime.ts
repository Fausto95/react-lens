import { loadSession } from "@reactlens/protocol";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import { createSourceResolver } from "@reactlens/source-maps";
import { createToolHandlers } from "@reactlens/agent-tools";
import { readFileSync } from "node:fs";

export function loadSessionFromPath(path: string) {
  const raw = readFileSync(path, "utf8");
  const session = loadSession(raw);
  const store = new TraceStore();
  store.ingest(session.payload);
  const causality = createCausality(store);
  const sourceResolver = createSourceResolver(async () => {
    throw new Error("source fetch unavailable in CLI");
  });
  const handlers = createToolHandlers({ store, causality, sourceResolver });
  return { session, store, causality, handlers };
}
