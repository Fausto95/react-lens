import { useMemo, useState, useEffect } from "react";
import type { TraceStore } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId } from "@react-lens/protocol";
import { analyzeSource, type Diagnostic, type StaticFinding } from "@react-lens/diagnostics";
import { diagnoseOne } from "./doctor.js";
import { sourceResolver } from "./sourceResolver.js";

export interface DoctorResult {
  runtime: Diagnostic[];
  staticFindings: StaticFinding[];
  total: number;
}

/**
 * Combines runtime diagnostics (sync) with static findings from the component's
 * original source (async, via source maps). The Inspector uses `total` to
 * decide whether to show the Doctor section; the DoctorTab renders both.
 */
export function useDoctor(
  store: TraceStore,
  causality: Causality,
  componentId: ComponentId,
): DoctorResult {
  const runtime = useMemo(
    () => diagnoseOne(store, causality, componentId),
    [store, causality, componentId],
  );

  const [staticFindings, setStaticFindings] = useState<StaticFinding[]>([]);
  useEffect(() => {
    const inst = store.instance(componentId);
    if (!inst?.source) {
      setStaticFindings([]);
      return;
    }
    let alive = true;
    sourceResolver
      .sourceContent(inst.source.file)
      .then((src) => alive && setStaticFindings(src ? analyzeSource(src.content) : []))
      .catch(() => alive && setStaticFindings([]));
    return () => {
      alive = false;
    };
  }, [store, componentId]);

  return { runtime, staticFindings, total: runtime.length + staticFindings.length };
}
