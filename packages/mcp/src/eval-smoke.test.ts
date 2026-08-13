import { describe, it, expect } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSession } from "@reactlens/protocol";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import { createSourceResolver } from "@reactlens/source-maps";
import { createToolHandlers } from "@reactlens/agent-tools";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../e2e/fixtures/minimal.lens.json",
);

describe("eval smoke", () => {
  it("diagnose_slowness on minimal fixture returns citations", async () => {
    const session = loadSession(readFileSync(FIXTURE, "utf8"));
    const store = new TraceStore();
    store.ingest(session.payload);
    const handlers = createToolHandlers({
      store,
      causality: createCausality(store),
      sourceResolver: createSourceResolver(async () => {
        throw new Error("no fetch");
      }),
    });
    const result = await handlers.diagnose_slowness({});
    expect(result).toMatchObject({ schemaVersion: 1 });
    if ("error" in result) throw new Error(result.error);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.verdict.length).toBeGreaterThan(0);
  });
});
