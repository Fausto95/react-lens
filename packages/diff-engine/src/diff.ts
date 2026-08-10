import type { DiffTarget, DiffTargetKind, DiffResult, DiffChange } from "./types.js";
import { compareValue } from "./value-diff.js";
import { compareDom } from "./dom-diff.js";

type Strategy = (target: DiffTarget) => DiffChange[];

/**
 * Declarative dispatch — one engine, a strategy per target kind. Adding a new
 * DiffTarget (css, visual, tree, …) means adding a row here, not a branch in
 * every caller.
 */
const strategies: Record<DiffTargetKind, Strategy> = {
  value: (t) => compareValue(asValue(t).before, asValue(t).after),
  props: (t) => compareValue(asValue(t).before, asValue(t).after),
  state: (t) => compareValue(asValue(t).before, asValue(t).after),
  context: (t) => compareValue(asValue(t).before, asValue(t).after),
  hooks: (t) => compareValue(asValue(t).before, asValue(t).after),
  dom: (t) => {
    const dom = t as Extract<DiffTarget, { kind: "dom" }>;
    return compareDom(dom.before, dom.after);
  },
};

function asValue(t: DiffTarget): Extract<DiffTarget, { kind: "value" }> {
  return t as Extract<DiffTarget, { kind: "value" }>;
}

export function diff(target: DiffTarget): DiffResult {
  const changes = strategies[target.kind](target);
  const changed = changes.filter((c) => c.kind !== "UNCHANGED").length;
  const referenceOnly = changes.filter((c) => c.kind === "REFERENCE_ONLY_CHANGED").length;
  return {
    target: target.kind,
    changes,
    summary: {
      changed,
      referenceOnly,
      observableOutputChanged: target.kind === "dom" ? changed > 0 : false,
    },
  };
}
