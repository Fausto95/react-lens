import type { TraceStore } from "@reactlens/trace-engine";
import type {
  RenderEvent,
  RenderReason,
  RenderId,
  RenderSnapshot,
  SerializedValue,
} from "@reactlens/protocol";
import { diff, type DiffResult } from "@reactlens/diff-engine";
import type { Cause, WhyResult } from "./types.js";

/**
 * Priority for ordering causes so the earliest actionable one comes first
 * (DESIGN §119). A component's own trigger (state/context/store) outranks a new
 * prop, which outranks "the parent rendered".
 */
const REASON_PRIORITY: Record<RenderReason["type"], number> = {
  state: 0,
  context: 0,
  "external-store": 0,
  "force-update": 0,
  props: 1,
  parent: 2,
  "compiler-bailout": 3,
  mount: 4,
};

export interface Causality {
  why(renderId: RenderId): WhyResult;
  rootCause(renderId: RenderId): Cause | undefined;
}

export function createCausality(store: TraceStore): Causality {
  function why(renderId: RenderId): WhyResult {
    const render = store.getRender(renderId);
    if (!render) throw new Error(`No render event for renderId ${String(renderId)}`);

    const history = store.rendersOf(render.componentId);
    const idx = history.findIndex((r) => r.renderId === renderId);
    const prev = idx > 0 ? history[idx - 1] : undefined;

    const cur = store.snapshot(renderId);
    const prevSnap = prev ? store.snapshot(prev.renderId) : undefined;

    const { observableOutputChanged, domKnown } = domVerdict(prevSnap, cur);

    const causes = buildCauses(store, render, prevSnap, cur);

    return {
      render,
      causes,
      observableOutputChanged,
      verdict: verdictOf(render, domKnown, observableOutputChanged),
    };
  }

  function rootCause(renderId: RenderId): Cause | undefined {
    return why(renderId).causes[0];
  }

  return { why, rootCause };
}

function domVerdict(
  prev: RenderSnapshot | undefined,
  cur: RenderSnapshot | undefined,
): { observableOutputChanged: boolean; domKnown: boolean } {
  if (prev?.dom && cur?.dom) {
    const result = diff({ kind: "dom", before: prev.dom, after: cur.dom });
    return { observableOutputChanged: result.summary.observableOutputChanged, domKnown: true };
  }
  return { observableOutputChanged: true, domKnown: false };
}

function verdictOf(
  render: RenderEvent,
  domKnown: boolean,
  observableOutputChanged: boolean,
): WhyResult["verdict"] {
  if (render.reasons.some((r) => r.type === "mount")) return "expected";
  if (!domKnown) return "unknown";
  return observableOutputChanged ? "expected" : "no-observable-change";
}

function buildCauses(
  store: TraceStore,
  render: RenderEvent,
  prev: RenderSnapshot | undefined,
  cur: RenderSnapshot | undefined,
): Cause[] {
  const sorted = [...render.reasons].sort(
    (a, b) => REASON_PRIORITY[a.type] - REASON_PRIORITY[b.type],
  );
  return sorted.map((reason) => reasonToCause(store, reason, prev, cur));
}

function reasonToCause(
  store: TraceStore,
  reason: RenderReason,
  prev: RenderSnapshot | undefined,
  cur: RenderSnapshot | undefined,
): Cause {
  switch (reason.type) {
    case "mount":
      return { level: 1, explanation: "Mounted for the first time.", confidence: 1 };

    case "parent": {
      const parent = store.instance(reason.componentId);
      const name = parent?.name ?? "its parent";
      return {
        level: 1,
        explanation: `Parent ${name} re-rendered.`,
        confidence: 1,
        sourceLocation: parent?.source,
      };
    }

    case "props": {
      const d = valueDiff("props", prev?.props, cur?.props);
      return {
        level: 2,
        explanation: propsExplanation(d, reason.changed),
        confidence: confidenceFromDiff(d),
        diff: d,
      };
    }

    case "state": {
      const d = valueDiff("state", prev?.state, cur?.state);
      return {
        level: 2,
        explanation: `State (hook #${reason.hookIndex}) changed.`,
        confidence: 1,
        diff: d,
      };
    }

    case "context": {
      const d = valueDiff("context", prev?.context, cur?.context);
      const type = store.instance(reason.contextType as never);
      return {
        level: 2,
        explanation: `Context ${type?.name ?? String(reason.contextType)} changed.`,
        confidence: 1,
        diff: d,
      };
    }

    case "external-store":
      return { level: 2, explanation: "A subscribed external store changed.", confidence: 1 };

    case "force-update":
      return { level: 2, explanation: "forceUpdate() was called.", confidence: 1 };

    case "compiler-bailout":
      return {
        level: 3,
        explanation: `React Compiler could not memoize this component: ${reason.reason}.`,
        confidence: 1,
      };
  }
}

function valueDiff(
  kind: "props" | "state" | "context",
  before: SerializedValue | undefined,
  after: SerializedValue | undefined,
): DiffResult | undefined {
  if (!before || !after) return undefined;
  return diff({ kind, before, after });
}

/**
 * If every observed change is a reference-only or function-identity change,
 * we cannot prove the render was meaningful — lower the confidence.
 */
function confidenceFromDiff(d: DiffResult | undefined): number {
  if (!d) return 1;
  const meaningful = d.changes.filter(
    (c) => c.kind === "VALUE_CHANGED" || c.kind === "ADDED" || c.kind === "REMOVED",
  );
  if (meaningful.length > 0) return 1;
  const onlyIdentity = d.changes.some(
    (c) => c.kind === "REFERENCE_ONLY_CHANGED" || c.kind === "FUNCTION_IDENTITY_CHANGED",
  );
  return onlyIdentity ? 0.6 : 1;
}

function propsExplanation(d: DiffResult | undefined, changedKeys: string[]): string {
  if (!d) {
    return changedKeys.length
      ? `Received new props: ${changedKeys.join(", ")}.`
      : "Received new props.";
  }
  const fnChanges = d.changes.filter((c) => c.kind === "FUNCTION_IDENTITY_CHANGED");
  const valueChanges = d.changes.filter((c) => c.kind === "VALUE_CHANGED");
  if (valueChanges.length === 0 && fnChanges.length > 0) {
    const names = fnChanges.map((c) => String(c.path.at(-1))).join(", ");
    return `Prop ${names} received a new function identity, but no prop values changed.`;
  }
  const changed = d.changes
    .filter((c) => c.path.length === 1 && c.kind !== "UNCHANGED")
    .map((c) => String(c.path[0]));
  return changed.length
    ? `Props changed: ${[...new Set(changed)].join(", ")}.`
    : "Received new props.";
}
