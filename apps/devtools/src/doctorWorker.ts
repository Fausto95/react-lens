/// <reference lib="webworker" />
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import type { EventsBatchMessage, ComponentId, SourceLocation } from "@reactlens/protocol";
import {
  analyzeSource,
  analyzeSourceSmart,
  mergeStaticAndRuntime,
  type Diagnostic,
} from "@reactlens/diagnostics";
import { createSourceResolver } from "@reactlens/source-maps";
import { diagnoseAll, buildInput } from "./doctor.js";

/**
 * Doctor worker: mirrors the panel's trace store and runs the all-components
 * diagnostic pass off the main thread. Optional per-component source texts
 * enable static (OXC / regex) fusion with runtime evidence.
 *
 * oxc-parser is dynamically imported; when native/WASM is unavailable,
 * `analyzeSourceSmart` falls back to regex. Source-map resolution also lives
 * here so the main thread never parses maps.
 */
type FrameMessage = { type: "frame"; batch: EventsBatchMessage["payload"] };
type SourceMessage = {
  type: "source";
  componentId: ComponentId;
  name: string;
  sourceText: string;
  file?: string;
};
type ClearSourcesMessage = { type: "clear-sources" };
type ResolveMessage = {
  type: "resolve";
  requestId: string;
  compiled: SourceLocation;
};
type InMessage = FrameMessage | SourceMessage | ClearSourcesMessage | ResolveMessage;

type DoctorResultMessage = {
  count: number;
  affected: ComponentId[];
  diagnostics: Diagnostic[];
  fused?: Diagnostic[];
};

type ResolveResultMessage = {
  type: "resolve-result";
  requestId: string;
  location: SourceLocation | null;
};

const store = new TraceStore();
const causality = createCausality(store);
const sources = new Map<ComponentId, { name: string; sourceText: string; file?: string }>();
const resolver = createSourceResolver();
let timer: ReturnType<typeof setTimeout> | undefined;

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<InMessage>) => void) | null;
  postMessage: (msg: DoctorResultMessage | ResolveResultMessage) => void;
};

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg?.type === "frame") {
    store.ingest(msg.batch);
    schedule();
  } else if (msg?.type === "source") {
    sources.set(msg.componentId, {
      name: msg.name,
      sourceText: msg.sourceText,
      ...(msg.file ? { file: msg.file } : {}),
    });
    schedule();
  } else if (msg?.type === "clear-sources") {
    sources.clear();
    schedule();
  } else if (msg?.type === "resolve") {
    void resolver
      .resolve(msg.compiled)
      .then((location) => {
        ctx.postMessage({
          type: "resolve-result",
          requestId: msg.requestId,
          location: location
            ? { file: location.file, line: location.line, column: location.column }
            : null,
        });
      })
      .catch(() => {
        ctx.postMessage({ type: "resolve-result", requestId: msg.requestId, location: null });
      });
  }
};

function schedule(): void {
  if (timer !== undefined) return;
  timer = setTimeout(() => {
    timer = undefined;
    void recompute();
  }, 200);
}

async function recompute(): Promise<void> {
  const { diagnostics, affected } = diagnoseAll(store, causality);
  const fusedExtra: Diagnostic[] = [];
  const affectedSet = new Set(affected);

  for (const [id, src] of sources) {
    const input = buildInput(store, causality, id);
    const runtime = diagnostics.filter((d) => d.componentId === id);
    try {
      const staticFindings = await analyzeSourceSmart(
        src.sourceText,
        { name: src.name, ...(src.file ? { file: src.file } : {}) },
        analyzeSource,
      );
      const fused = mergeStaticAndRuntime(staticFindings, runtime, {
        componentId: id,
        selfTime: input?.selfTime ?? 0,
        renders: input?.renders ?? 0,
        suspiciousRenders: input?.suspiciousRenders ?? 0,
      });
      for (const d of fused) {
        if (!runtime.some((r) => r.ruleId === d.ruleId)) fusedExtra.push(d);
        affectedSet.add(d.componentId);
      }
    } catch {
      /* Static analysis must never block the trace path. */
    }
  }

  const all = [...diagnostics, ...fusedExtra].sort((a, b) => b.impact - a.impact);
  const top = all.slice(0, 50);
  ctx.postMessage({
    count: all.length,
    affected: [...affectedSet],
    diagnostics: top,
    ...(sources.size > 0 ? { fused: top } : {}),
  });
}
