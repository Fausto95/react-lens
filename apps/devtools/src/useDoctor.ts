import { useMemo, useState, useEffect } from "react";
import type { TraceStore } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId } from "@react-lens/protocol";
import {
  analyzeSource,
  analyzeSourceSmart,
  mergeStaticAndRuntime,
  type Diagnostic,
  type StaticFinding,
} from "@react-lens/diagnostics";
import { diagnoseOne, buildInput } from "./doctor.js";
import { sourceResolver } from "./sourceResolver.js";

export interface DoctorResult {
  runtime: Diagnostic[];
  staticFindings: StaticFinding[];
  /** Fused static + runtime, impact-ranked. */
  fused: Diagnostic[];
  total: number;
}

/**
 * Combines runtime diagnostics (sync) with static findings from the component's
 * original source (async). Prefers oxc AST analysis; falls back to regex.
 * Static findings are fused with runtime evidence for impact ranking.
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

  const evidence = useMemo(() => {
    const input = buildInput(store, causality, componentId);
    return {
      componentId,
      selfTime: input?.selfTime ?? 0,
      renders: input?.renders ?? 0,
      suspiciousRenders: input?.suspiciousRenders ?? 0,
    };
  }, [store, causality, componentId]);

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
        const findings = await analyzeSourceSmart(
          src.content,
          { name: inst.name, file },
          analyzeSource,
        );
        if (alive) setStaticFindings(findings);
      })
      .catch(() => alive && setStaticFindings([]));
    return () => {
      alive = false;
    };
  }, [store, componentId]);

  const fused = useMemo(
    () => mergeStaticAndRuntime(staticFindings, runtime, evidence),
    [staticFindings, runtime, evidence],
  );

  return {
    runtime,
    staticFindings,
    fused,
    total: fused.length,
  };
}
