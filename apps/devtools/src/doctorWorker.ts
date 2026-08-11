/// <reference lib="webworker" />
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import type { EventsBatchMessage, ComponentId } from "@reactlens/protocol";
import {
  analyzeSource,
  analyzeSourceSmart,
  mergeStaticAndRuntime,
  type Diagnostic,
} from "@reactlens/diagnostics";
import { diagnoseAll, buildInput } from "./doctor.js";

/**
 * Doctor worker: mirrors the panel's trace store and runs the all-components
 * diagnostic pass off the main thread. Optional per-component source texts
 * enable static (OXC / regex) fusion with runtime evidence.
 *
 * Bundlers stub `oxc-parser` (WASM isn't browser-bundleable). Static analysis
 * still runs via `analyzeSourceSmart` → regex fallback.
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
type InMessage = FrameMessage | SourceMessage | ClearSourcesMessage;

type DoctorResultMessage = {
  count: number;
  affected: ComponentId[];
  /** Optional fused diagnostics for components that have source uploaded. */
  fused?: Diagnostic[];
};

const store = new TraceStore();
const causality = createCausality(store);
const sources = new Map<ComponentId, { name: string; sourceText: string; file?: string }>();
let timer: ReturnType<typeof setTimeout> | undefined;

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<InMessage>) => void) | null;
  postMessage: (msg: DoctorResultMessage) => void;
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
      /* ignore per-component failures */
    }
  }

  const all = [...diagnostics, ...fusedExtra].sort((a, b) => b.impact - a.impact);
  ctx.postMessage({
    count: all.length,
    affected: [...affectedSet],
    ...(sources.size > 0 ? { fused: all.slice(0, 50) } : {}),
  });
}
