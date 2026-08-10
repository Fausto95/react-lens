import type {
  ComponentId,
  RenderId,
  RenderEvent,
  EffectEvent,
  HookSnapshot,
} from "@react-lens/protocol";
import type { TraceStore } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import { diff, type DiffResult } from "@react-lens/diff-engine";
import { definitionSpan, type Diagnostic } from "@react-lens/diagnostics";
import { explainInteraction, type LensRef } from "@react-lens/explain";
import type { SourceResolver } from "@react-lens/source-maps";
import { buildGraph, neighbors, componentKey } from "@react-lens/graph";
import type { CauseSummary, HooksDiffRow, ToolHandlers } from "./types.js";

const SNIPPET_MAX_LINES = 200;
const SNIPPET_MAX_CHARS = 8_000;
const FILE_HEAD_LINES = 120;

export function createToolHandlers(deps: {
  store: TraceStore;
  causality: Causality;
  diagnose: (id: ComponentId) => Diagnostic[];
  sourceResolver: SourceResolver;
}): ToolHandlers {
  const { store, causality, diagnose, sourceResolver } = deps;

  const componentRef = (id: ComponentId): LensRef => ({
    kind: "component",
    id,
    label: store.instance(id)?.name ?? `#${id}`,
  });

  return {
    explain_interaction: ({ interactionId }) => {
      const interactions = store.interactions();
      const it =
        (interactionId ? interactions.find((i) => i.id === interactionId) : null) ??
        interactions.at(-1);
      if (!it) return { error: "no interaction recorded yet — interact with the page first" };
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
        interaction: it ? { id: it.id, label: it.label, kind: it.kind, metrics: it.metrics } : null,
        topRenders: renders,
        citations: it
          ? [
              { kind: "interaction" as const, id: it.id, label: it.label },
              ...renders.slice(0, 3).map((r) => componentRef(r.componentId)),
            ]
          : [],
      };
    },

    why: ({ renderId }) => {
      const render = store.getRender(renderId as RenderId);
      if (!render) {
        return {
          error: `Unknown renderId ${renderId} — use component_renders or query_trace to find real render ids.`,
        };
      }
      const why = causality.why(renderId as RenderId);
      const instance = store.instance(why.render.componentId);
      return {
        renderId,
        componentId: why.render.componentId,
        componentName: instance?.name ?? `#${why.render.componentId}`,
        verdict: why.verdict,
        observableOutputChanged: why.observableOutputChanged,
        ...(instance ? { compiler: instance.compiler } : {}),
        causes: why.causes.map((c) => summarizeCause(c)),
        citations: [
          {
            kind: "render" as const,
            id: why.render.renderId,
            label: `render ${why.render.renderId}`,
            componentId: why.render.componentId,
          },
          componentRef(why.render.componentId),
        ],
      };
    },

    diff_snapshots: ({ kind, beforeRenderId, afterRenderId }) => {
      const before = store.snapshot(beforeRenderId as RenderId);
      const after = store.snapshot(afterRenderId as RenderId);
      if (!before || !after) {
        return { error: "missing snapshot — snapshots are retained per render; pick recent renderIds" };
      }
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
          componentRef(id),
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

    find_component: ({ name }) => {
      const q = name.trim().toLowerCase();
      if (!q) return { error: "name must be a non-empty string" };
      const matches = store
        .allInstances()
        .filter((i) => i.name.toLowerCase().includes(q))
        .map((i) => ({
          componentId: i.id,
          name: i.name,
          renders: store.renderCount(i.id),
          totalSelf: round(store.selfTimeTotal(i.id)),
          ...(i.source ? { source: i.source } : {}),
        }))
        .sort((a, b) => b.totalSelf - a.totalSelf)
        .slice(0, 10);
      return {
        matches,
        citations: matches.slice(0, 3).map((m) => componentRef(m.componentId)),
      };
    },

    component_renders: ({ componentId, limit = 10 }) => {
      const id = componentId as ComponentId;
      const instance = store.instance(id);
      if (!instance) {
        return { error: `Unknown componentId ${componentId} — use find_component to look it up.` };
      }
      const renders = store
        .rendersOf(id)
        .slice()
        .sort((a, b) => b.selfDuration - a.selfDuration)
        .slice(0, limit)
        .map((r) => ({
          renderId: r.renderId,
          timestamp: round(r.timestamp),
          self: round(r.selfDuration),
          commitId: r.commitId as number,
          reasons: r.reasons.map((reason) => reason.type),
        }));
      return {
        componentId: id,
        componentName: instance.name,
        renders,
        citations: [componentRef(id)],
      };
    },

    read_component_source: async ({ componentId, contextLines = 8 }) => {
      const id = componentId as ComponentId;
      const instance = store.instance(id);
      if (!instance) {
        return { error: `Unknown componentId ${componentId} — use find_component to look it up.` };
      }
      const base = {
        componentId: id,
        name: instance.name,
        citations: [componentRef(id)],
      };
      const loc = instance.source;
      if (!loc) {
        return { ...base, file: null, snippet: null, truncated: false, reason: "no source location recorded for this component" };
      }
      const original = await sourceResolver.resolve(loc);
      let content = await sourceResolver.sourceContent(loc.file, original?.file ?? undefined);
      if (!content) {
        return {
          ...base,
          file: original?.file ?? null,
          snippet: null,
          truncated: false,
          reason: "original source unavailable (no source map or sourcesContent)",
        };
      }
      let span = definitionSpan(content.content, instance.name);
      if (!span) {
        // React records the JSX *creation* site, so `loc` usually points at the
        // parent module. Chase the import that names this component to the
        // module that actually defines it.
        const imported = await chaseImport(sourceResolver, loc.file, content.content, instance.name);
        if (imported) {
          content = imported.content;
          span = imported.span;
        }
      }
      const lines = content.content.split("\n");
      let startLine: number;
      let endLine: number;
      let reason: string | undefined;
      if (span) {
        startLine = Math.max(1, span.startLine - contextLines);
        endLine = Math.min(lines.length, span.endLine + contextLines);
      } else {
        startLine = 1;
        endLine = Math.min(lines.length, FILE_HEAD_LINES);
        reason = "definition not located; showing the file head";
      }
      let truncated = false;
      if (endLine - startLine + 1 > SNIPPET_MAX_LINES) {
        endLine = startLine + SNIPPET_MAX_LINES - 1;
        truncated = true;
      }
      let snippet = lines
        .slice(startLine - 1, endLine)
        .map((text, i) => `${startLine + i} | ${text}`)
        .join("\n");
      if (snippet.length > SNIPPET_MAX_CHARS) {
        snippet = snippet.slice(0, SNIPPET_MAX_CHARS);
        truncated = true;
      }
      if (!span && !truncated && endLine < lines.length) truncated = true;
      return {
        ...base,
        file: content.path ?? original?.file ?? null,
        ...(span ? { span } : {}),
        snippet,
        truncated,
        ...(reason ? { reason } : {}),
      };
    },

    effects_summary: ({ componentId }) => {
      const id = componentId as ComponentId;
      const instance = store.instance(id);
      if (!instance) {
        return { error: `Unknown componentId ${componentId} — use find_component to look it up.` };
      }
      const effects = store
        .allEvents()
        .filter((e): e is EffectEvent => e.type === "effect" && e.componentId === id);
      const runs = effects.filter((e) => e.phase === "run");
      const cleanups = effects.filter((e) => e.phase === "cleanup");
      const recentRenders = store.rendersOf(id).slice(-12);
      // Same heuristic the Effects tab shows as "possible loop".
      const possibleLoop = recentRenders.length >= 4 && runs.length >= recentRenders.length - 1;
      const byHook = new Map<number, { runs: number; totalMs: number }>();
      for (const e of runs) {
        const key = e.hookIndex ?? -1;
        const slot = byHook.get(key) ?? { runs: 0, totalMs: 0 };
        slot.runs++;
        slot.totalMs += e.duration;
        byHook.set(key, slot);
      }
      return {
        componentId: id,
        componentName: instance.name,
        runs: runs.length,
        cleanups: cleanups.length,
        totalRunMs: round(runs.reduce((s, e) => s + e.duration, 0)),
        possibleLoop,
        hooks: [...byHook.entries()]
          .map(([hookIndex, v]) => ({ hookIndex, runs: v.runs, totalMs: round(v.totalMs) }))
          .sort((a, b) => b.totalMs - a.totalMs),
        citations: [componentRef(id)],
      };
    },

    graph_neighbors: ({ componentId }) => {
      const id = componentId as ComponentId;
      const instance = store.instance(id);
      if (!instance) {
        return { error: `Unknown componentId ${componentId} — use find_component to look it up.` };
      }
      const graph = buildGraph({ components: store.allInstances() });
      const around = neighbors(graph, componentKey(id));
      const toEntry = (key: string) => {
        const node = graph.nodes.get(key);
        return node && node.kind === "component"
          ? { componentId: node.ref as ComponentId, name: node.label }
          : null;
      };
      // Ownership edges point child → parent.
      const parents = around.outgoing
        .filter((e) => e.kind === "parent")
        .map((e) => toEntry(e.to))
        .filter((x): x is { componentId: ComponentId; name: string } => x !== null);
      const children = around.incoming
        .filter((e) => e.kind === "parent")
        .map((e) => toEntry(e.from))
        .filter((x): x is { componentId: ComponentId; name: string } => x !== null);
      return {
        componentId: id,
        componentName: instance.name,
        parents,
        children,
        citations: [componentRef(id), ...parents.slice(0, 2).map((p) => componentRef(p.componentId))],
      };
    },
  };
}

/**
 * Find `import { Name } from "./x"` in the creation-site module and load the
 * defining module's original source. Specifiers are resolved against the
 * compiled module URL, trying the usual TS/ESM extension spellings (`.js`
 * specifiers compile from `.tsx`/`.ts` files under Vite/tsc conventions).
 */
async function chaseImport(
  sourceResolver: SourceResolver,
  compiledFile: string,
  creationSource: string,
  name: string,
): Promise<{ content: { path: string; content: string }; span: { startLine: number; endLine: number } } | null> {
  const importRe = new RegExp(
    `import\\s+(?:[^;'"]*[\\s{,])?${escapeRe(name)}[\\s,}][^;'"]*from\\s+["']([^"']+)["']`,
  );
  const match = importRe.exec(creationSource);
  const specifier = match?.[1];
  if (!specifier || !specifier.startsWith(".")) return null;

  const bare = specifier.replace(/\.(js|jsx|ts|tsx)$/, "");
  const candidates = [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"].map((ext) => bare + ext);
  if (/\.(js|jsx|ts|tsx)$/.test(specifier)) candidates.unshift(specifier);
  for (const candidate of candidates) {
    let url: string;
    try {
      url = new URL(candidate, compiledFile).href;
    } catch {
      continue;
    }
    const content = await sourceResolver.sourceContent(url).catch(() => null);
    if (!content) continue;
    const span = definitionSpan(content.content, name);
    if (span) return { content, span };
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Project a Cause into what the model needs: evidence, not internals. */
function summarizeCause(c: {
  level: 1 | 2 | 3;
  explanation: string;
  confidence: number;
  diff?: DiffResult;
  sourceLocation?: { file: string; line: number; column: number };
}): CauseSummary {
  const changes = c.diff?.changes.filter((ch) => ch.kind !== "UNCHANGED") ?? [];
  return {
    level: c.level,
    explanation: c.explanation,
    confidence: c.confidence,
    ...(c.diff ? { diffSummary: c.diff.summary } : {}),
    ...(changes.length > 0
      ? { topChanges: changes.slice(0, 5).map((ch) => ({ path: ch.path.join("."), kind: ch.kind })) }
      : {}),
    ...(c.sourceLocation ? { source: c.sourceLocation } : {}),
  };
}

/** Align two hook lists by index and report value/deps changes per slot. */
function diffHooks(before: HookSnapshot[], after: HookSnapshot[]): HooksDiffRow[] {
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

function sameDeps(a: HookSnapshot["deps"], b: HookSnapshot["deps"]): boolean {
  if (a == null || b == null) return a == b; // null and undefined both mean "no deps"
  if (a.length !== b.length) return false;
  return a.every((v, i) => sameSerialized(v, b[i]));
}

function pick(
  snap: {
    props?: unknown;
    state?: unknown;
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
    case "context":
      return snap.context;
    case "dom":
      return snap.dom;
    default:
      return undefined;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
