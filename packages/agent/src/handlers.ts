import type { ComponentId, RenderId, RenderEvent, HookSnapshot } from "@react-lens/protocol";
import type { TraceStore } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import { diff } from "@react-lens/diff-engine";
import type { Diagnostic } from "@react-lens/diagnostics";
import { explainInteraction } from "@react-lens/explain";
import type { SourceResolver } from "@react-lens/source-maps";
import type { ToolHandlers } from "./types.js";

export function createToolHandlers(deps: {
  store: TraceStore;
  causality: Causality;
  diagnose: (id: ComponentId) => Diagnostic[];
  sourceResolver: SourceResolver;
}): ToolHandlers {
  const { store, causality, diagnose, sourceResolver } = deps;

  return {
    explain_interaction: ({ interactionId }) => {
      const interactions = store.interactions();
      const it =
        (interactionId ? interactions.find((i) => i.id === interactionId) : null) ??
        interactions.at(-1);
      if (!it) return { error: "no interaction" };
      return explainInteraction(store, causality, it, { diagnose });
    },

    query_trace: ({ interactionId, limit = 8 }) => {
      const stats = store.stats();
      const interactions = store.interactions();
      const it =
        (interactionId ? interactions.find((i) => i.id === interactionId) : null) ??
        interactions.at(-1);
      const renders = (it?.renderIds ?? [])
        .map((id) => store.getRender(id))
        .filter((r): r is RenderEvent => r != null)
        .sort((a, b) => b.selfDuration - a.selfDuration)
        .slice(0, limit)
        .map((r) => ({
          renderId: r.renderId,
          componentId: r.componentId,
          name: store.instance(r.componentId)?.name ?? `#${r.componentId}`,
          self: r.selfDuration,
        }));
      return {
        stats,
        interaction: it
          ? {
              id: it.id,
              label: it.label,
              kind: it.kind,
              metrics: it.metrics,
            }
          : null,
        topRenders: renders,
        citations: it
          ? [
              { kind: "interaction" as const, id: it.id, label: it.label },
              ...renders.slice(0, 3).map((r) => ({
                kind: "component" as const,
                id: r.componentId,
                label: r.name,
              })),
            ]
          : [],
      };
    },

    why: ({ renderId }) => {
      const why = causality.why(renderId as RenderId);
      return {
        renderId,
        componentId: why.render.componentId,
        verdict: why.verdict,
        causes: why.causes.map((c) => ({
          level: c.level,
          explanation: c.explanation,
          confidence: c.confidence,
        })),
        citations: [
          {
            kind: "render" as const,
            id: why.render.renderId,
            label: `render ${why.render.renderId}`,
            componentId: why.render.componentId,
          },
          {
            kind: "component" as const,
            id: why.render.componentId,
            label: store.instance(why.render.componentId)?.name ?? `#${why.render.componentId}`,
          },
        ],
      };
    },

    root_cause: ({ renderId }) => {
      const cause = causality.rootCause(renderId as RenderId);
      const render = store.getRender(renderId as RenderId);
      return {
        renderId,
        cause: cause
          ? { level: cause.level, explanation: cause.explanation, confidence: cause.confidence }
          : null,
        citations: render
          ? [
              {
                kind: "render" as const,
                id: render.renderId,
                label: `render ${render.renderId}`,
                componentId: render.componentId,
              },
            ]
          : [],
      };
    },

    diff_snapshots: ({ kind, beforeRenderId, afterRenderId }) => {
      const before = store.snapshot(beforeRenderId as RenderId);
      const after = store.snapshot(afterRenderId as RenderId);
      if (!before || !after) return { error: "missing snapshot" };
      // Hooks are HookSnapshot[] rows, not a SerializedValue tree — the value
      // differ would walk them as opaque objects. Compare per hook index.
      if (kind === "hooks") {
        if (!before.hooks || !after.hooks) return { error: "snapshot missing hooks" };
        const hooks = diffHooks(before.hooks, after.hooks);
        return {
          kind,
          beforeRenderId,
          afterRenderId,
          hooks,
          changeCount: hooks.filter((h) => h.valueChanged || h.depsChanged).length,
        };
      }
      const left = pick(before, kind);
      const right = pick(after, kind);
      if (left === undefined || right === undefined) {
        return { error: `snapshot missing ${kind}` };
      }
      const result = diff({ kind, before: left as never, after: right as never });
      return {
        kind,
        beforeRenderId,
        afterRenderId,
        summary: result.summary,
        changeCount: result.changes.length,
        changes: result.changes.slice(0, 20),
      };
    },

    diagnose: ({ componentId }) => {
      const id = componentId as ComponentId;
      const list = diagnose(id);
      return {
        componentId: id,
        name: store.instance(id)?.name ?? `#${id}`,
        diagnostics: list,
        citations: [
          {
            kind: "component" as const,
            id,
            label: store.instance(id)?.name ?? `#${id}`,
          },
          ...list.slice(0, 3).map((d) => ({
            kind: "doctor" as const,
            ruleId: d.ruleId,
            componentId: d.componentId,
            label: d.title,
          })),
        ],
      };
    },

    resolve_source: async ({ file, line, column }) => {
      const original = await sourceResolver.resolve({ file, line, column });
      const content = await sourceResolver.sourceContent(file, original?.file);
      return {
        compiled: { file, line, column },
        original,
        path: content?.path ?? original?.file ?? null,
        preview: content?.content.slice(0, 500) ?? null,
      };
    },
  };
}

/** Align two hook lists by index and report value/deps changes per slot. */
function diffHooks(
  before: HookSnapshot[],
  after: HookSnapshot[],
): Array<{ index: number; hookKind: string; valueChanged: boolean; depsChanged: boolean }> {
  const byIndex = new Map(before.map((h) => [h.index, h]));
  return after.map((h) => {
    const prev = byIndex.get(h.index);
    return {
      index: h.index,
      hookKind: h.kind,
      valueChanged: prev !== undefined && !sameSerialized(prev.value, h.value),
      depsChanged: prev !== undefined && !sameDeps(prev.deps, h.deps),
    };
  });
}

function sameSerialized(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameDeps(
  a: HookSnapshot["deps"],
  b: HookSnapshot["deps"],
): boolean {
  if (a == null || b == null) return a == b; // null and undefined both mean "no deps"
  if (a.length !== b.length) return false;
  return a.every((v, i) => sameSerialized(v, b[i]));
}

function pick(
  snap: {
    props?: unknown;
    state?: unknown;
    hooks?: unknown;
    context?: unknown;
    dom?: unknown;
  },
  kind: string,
): unknown {
  switch (kind) {
    case "props":
      return snap.props;
    case "state":
      return snap.state;
    case "hooks":
      return snap.hooks;
    case "context":
      return snap.context;
    case "dom":
      return snap.dom;
    default:
      return undefined;
  }
}
