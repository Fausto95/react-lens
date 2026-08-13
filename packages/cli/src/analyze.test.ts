import { describe, it, expect } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSession } from "@reactlens/protocol";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import { createSourceResolver } from "@reactlens/source-maps";
import { createToolHandlers } from "@reactlens/agent-tools";
import { analyzeSessionMarkdown } from "./analyze.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../../../e2e/fixtures/minimal.lens.json");

describe("cli analyze golden", () => {
  it("produces stable summary stats from minimal.lens.json", async () => {
    const raw = readFileSync(FIXTURE, "utf8");
    const session = loadSession(raw);
    const store = new TraceStore();
    store.ingest(session.payload);
    const handlers = createToolHandlers({
      store,
      causality: createCausality(store),
      sourceResolver: createSourceResolver(async () => {
        throw new Error("no fetch");
      }),
    });
    const summary = await handlers.get_session_summary({});
    expect(summary).toMatchObject({
      schemaVersion: 1,
      evidence: {
        stats: { events: 60, renders: 60, snapshots: 30, components: 60 },
      },
    });
    const md = await analyzeSessionMarkdown(session, handlers);
    expect(md).toContain("# React Lens Analysis");
    expect(md).toContain("Events: 60");
    expect(md).toContain("Renders: 60");
    expect(md).toContain("Components: 60");
  });
});
