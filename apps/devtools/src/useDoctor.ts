import { useMemo, useState, useEffect } from "react";
import type { TraceStore } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId } from "@react-lens/protocol";
import { analyzeSource, analyzeSourceSmart, type Diagnostic, type StaticFinding } from "@react-lens/diagnostics";
import { diagnoseOne } from "./doctor.js";
import { sourceResolver } from "./sourceResolver.js";

export interface DoctorResult {
  runtime: Diagnostic[];
  staticFindings: StaticFinding[];
  total: number;
}

/**
 * Combines runtime diagnostics (sync) with static findings from the component's
 * original source (async). Prefers oxc AST analysis; falls back to regex.
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
    const compiled = inst.source;
    Promise.all([sourceResolver.resolve(compiled), sourceResolver.sourceContent(compiled.file)])
      .then(async ([original, src]) => {
        if (!alive) return;
        if (!src) {
          setStaticFindings([]);
          return;
        }
        const file = original?.file ?? src.path;
        const findings = await analyzeSourceSmart(src.content, { name: inst.name, file }, analyzeSource);
        if (alive) setStaticFindings(findings);
      })
      .catch(() => alive && setStaticFindings([]));
    return () => {
      alive = false;
    };
  }, [store, componentId]);

  return { runtime, staticFindings, total: runtime.length + staticFindings.length };
}
