import type {
  ComponentId,
  RenderId,
  RenderEvent,
  EffectEvent,
  HookSnapshot,
} from "@reactlens/protocol";
import { interactionKindLabel, type TraceStore } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import { diff, type DiffResult } from "@reactlens/diff-engine";
import { definitionSpan, type Diagnostic } from "@reactlens/diagnostics";
import { explainInteraction, type LensRef } from "@reactlens/explain";
import type { SourceResolver } from "@reactlens/source-maps";
import { buildGraph, neighbors, componentKey } from "@reactlens/graph";
import type { CauseSummary, HooksDiffRow, ToolHandlers } from "./types.js";
import { TOOL_SCHEMA_VERSION } from "./types.js";
import { summarizeValue } from "./summarize.js";
import { compareSessions } from "./compare.js";
import { buildEvidencePack } from "./evidence.js";
import type { EventsBatchMessage } from "@reactlens/protocol";
import { createDefaultDiagnose } from "./doctor.js";

const SNIPPET_MAX_LINES = 200;
const SNIPPET_MAX_CHARS = 8_000;
const FILE_HEAD_LINES = 120;

export function createToolHandlers(deps: {
  store: TraceStore;
  causality: Causality;
  diagnose?: (id: ComponentId) => Diagnostic[];
  sourceResolver: SourceResolver;
}): ToolHandlers {
  const {
    store,
    causality,
    diagnose = createDefaultDiagnose(store, causality),
    sourceResolver,
  } = deps;

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
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
        ...explainInteraction(store, causality, it, { diagnose }),
      };
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
          selfMs: round(r.selfDuration),
        }));
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
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
        schemaVersion: TOOL_SCHEMA_VERSION,
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
        return {
          error: "missing snapshot — snapshots are retained per render; pick recent renderIds",
        };
      }
      // Hooks are HookSnapshot[] rows, not a SerializedValue tree — the value
      // differ would walk them as opaque objects. Compare per hook index.
      if (kind === "hooks") {
        if (!before.hooks || !after.hooks) return { error: "snapshot missing hooks" };
        const hooks = diffHooks(before.hooks, after.hooks);
        return {
          schemaVersion: TOOL_SCHEMA_VERSION,
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
        schemaVersion: TOOL_SCHEMA_VERSION,
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
        schemaVersion: TOOL_SCHEMA_VERSION,
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
        schemaVersion: TOOL_SCHEMA_VERSION,
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
          totalSelfMs: round(store.selfTimeTotal(i.id)),
          ...(i.source ? { source: i.source } : {}),
        }))
        .sort((a, b) => b.totalSelfMs - a.totalSelfMs)
        .slice(0, 10);
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
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
          timestampMs: round(r.timestamp),
          selfMs: round(r.selfDuration),
          commitId: r.commitId as number,
          reasons: r.reasons.map((reason) => reason.type),
        }));
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
        componentId: id,
        componentName: instance.name,
        renders,
        citations: [componentRef(id)],
      };
    },

    component_runtime: ({ componentId }) => {
      const id = componentId as ComponentId;
      const instance = store.instance(id);
      if (!instance) {
        return { error: `Unknown componentId ${componentId} — use find_component to look it up.` };
      }
      const retained = store.rendersOf(id);

      let maxSelf = 0;
      let wasted = 0;
      const reasons: Record<string, number> = {};
      for (const r of retained) {
        if (r.selfDuration > maxSelf) maxSelf = r.selfDuration;
        for (const reason of r.reasons) reasons[reason.type] = (reasons[reason.type] ?? 0) + 1;
        try {
          if (causality.why(r.renderId).verdict === "no-observable-change") wasted++;
        } catch {
          /* render evicted between reads — skip */
        }
      }

      const renders = store.renderCount(id);
      const totalSelf = store.selfTimeTotal(id);
      const lastRender = retained.at(-1);

      let latest: {
        renderId: RenderId;
        props: ReturnType<typeof summarizeValue> | null;
        hooks: Array<{
          index: number;
          kind: string;
          value: ReturnType<typeof summarizeValue> | null;
          hasDeps: boolean;
        }>;
        contexts: Array<{ name?: string; value: ReturnType<typeof summarizeValue> | null }>;
      } | null = null;
      for (let i = retained.length - 1; i >= 0 && !latest; i--) {
        const snap = store.snapshot(retained[i]!.renderId);
        if (!snap) continue;
        latest = {
          renderId: snap.renderId,
          props: snap.props ? summarizeValue(snap.props) : null,
          hooks: (snap.hooks ?? []).map((h) => ({
            index: h.index,
            kind: h.kind,
            value: h.value ? summarizeValue(h.value) : null,
            hasDeps: h.deps != null,
          })),
          contexts: (snap.contexts ?? []).map((c) => ({
            ...(c.displayName ? { name: c.displayName } : {}),
            value: c.value ? summarizeValue(c.value) : null,
          })),
        };
      }

      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
        componentId: id,
        componentName: instance.name,
        kind: instance.kind ?? "component",
        compiler: instance.compiler,
        ...(instance.source ? { source: instance.source } : {}),
        stats: {
          renders,
          totalSelfMs: round(totalSelf),
          avgSelfMs: renders > 0 ? round(totalSelf / renders) : 0,
          maxSelfMs: round(maxSelf),
          lastRenderId: lastRender?.renderId ?? null,
          wastedRenders: wasted,
          functionPropChurn: hasFunctionPropChurn(causality, lastRender?.renderId),
        },
        reasons,
        latest,
        ...(latest
          ? {}
          : {
              snapshotReason:
                "no snapshot retained for this component — select it in the Inspector to fetch one, or analyze renders via why.",
            }),
        citations: [
          componentRef(id),
          ...(latest
            ? [
                {
                  kind: "render" as const,
                  id: latest.renderId,
                  label: `render ${latest.renderId}`,
                  componentId: id,
                },
              ]
            : []),
        ],
      };
    },

    read_component_source: async ({ componentId, contextLines = 8 }) => {
      const id = componentId as ComponentId;
      const instance = store.instance(id);
      if (!instance) {
        return { error: `Unknown componentId ${componentId} — use find_component to look it up.` };
      }
      const base = {
        schemaVersion: TOOL_SCHEMA_VERSION,
        componentId: id,
        name: instance.name,
        citations: [componentRef(id)],
      };
      const loc = instance.source;
      if (!loc) {
        return {
          ...base,
          file: null,
          snippet: null,
          truncated: false,
          reason: "no source location recorded for this component",
        };
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
        const imported = await chaseImport(
          sourceResolver,
          loc.file,
          content.content,
          instance.name,
        );
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
        schemaVersion: TOOL_SCHEMA_VERSION,
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
        schemaVersion: TOOL_SCHEMA_VERSION,
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
      const parents = around.outgoing
        .filter((e) => e.kind === "parent")
        .map((e) => toEntry(e.to))
        .filter((x): x is { componentId: ComponentId; name: string } => x !== null);
      const children = around.incoming
        .filter((e) => e.kind === "parent")
        .map((e) => toEntry(e.from))
        .filter((x): x is { componentId: ComponentId; name: string } => x !== null);
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
        componentId: id,
        componentName: instance.name,
        parents,
        children,
        citations: [
          componentRef(id),
          ...parents.slice(0, 2).map((p) => componentRef(p.componentId)),
        ],
      };
    },

    list_interactions: ({ limit = 20 }) => {
      const interactions = store
        .interactions()
        .slice()
        .sort((a, b) => b.metrics.reactDuration - a.metrics.reactDuration)
        .slice(0, limit)
        .map((i) => ({
          id: i.id,
          label: i.label,
          kind: interactionKindLabel(i),
          durationMs: round(i.metrics.totalDuration),
          reactMs: round(i.metrics.reactDuration),
          renderCount: i.metrics.renderCount,
        }));
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
        interactions,
        citations: interactions
          .slice(0, 5)
          .map((i) => ({ kind: "interaction" as const, id: i.id, label: i.label })),
      };
    },

    get_session_summary: () => {
      const evidence = buildEvidencePack(store);
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
        evidence,
        citations: [
          ...evidence.interactions.slice(0, 3).map((i) => ({
            kind: "interaction" as const,
            id: i.id,
            label: i.label,
          })),
          ...evidence.topComponents
            .slice(0, 3)
            .map((c) => componentRef(c.componentId as ComponentId)),
        ],
      };
    },

    list_components: ({ name, limit = 20 }) => {
      const q = name?.trim().toLowerCase();
      const components = store
        .allInstances()
        .filter((i) => store.renderCount(i.id) > 0)
        .filter((i) => !q || i.name.toLowerCase().includes(q))
        .map((i) => ({
          componentId: i.id,
          name: i.name,
          renders: store.renderCount(i.id),
          totalSelfMs: round(store.selfTimeTotal(i.id)),
          compiled: i.compiler.compiled,
          ...(i.source ? { source: i.source } : {}),
        }))
        .sort((a, b) => b.totalSelfMs - a.totalSelfMs)
        .slice(0, limit);
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
        components,
        citations: components.slice(0, 5).map((c) => componentRef(c.componentId)),
      };
    },

    get_waste_report: ({ limit = 15 }) => {
      const waste: Array<{
        componentId: ComponentId;
        name: string;
        renderId: RenderId;
        selfMs: number;
        source?: { file: string; line: number; column: number };
      }> = [];
      for (const inst of store.allInstances()) {
        for (const r of store.rendersOf(inst.id)) {
          try {
            if (causality.why(r.renderId).verdict !== "no-observable-change") continue;
            waste.push({
              componentId: inst.id,
              name: inst.name,
              renderId: r.renderId,
              selfMs: round(r.selfDuration),
              ...(inst.source ? { source: inst.source } : {}),
            });
          } catch {
            /* skip */
          }
        }
      }
      waste.sort((a, b) => b.selfMs - a.selfMs);
      const top = waste.slice(0, limit);
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
        waste: top,
        citations: top.slice(0, 5).map((w) => componentRef(w.componentId)),
      };
    },

    diff_commits: ({ beforeCommitId, afterCommitId }) => {
      const commits = store.commits();
      const before = commits.find((c) => (c.commitId as number) === beforeCommitId);
      const after = commits.find((c) => (c.commitId as number) === afterCommitId);
      if (!before || !after) {
        return {
          error: "unknown commit id — use get_session_summary / query_trace to find commits",
        };
      }
      const beforeSet = new Set(before.componentIds);
      const afterSet = new Set(after.componentIds);
      const added = [...afterSet].filter((id) => !beforeSet.has(id));
      const removed = [...beforeSet].filter((id) => !afterSet.has(id));
      const shared = [...afterSet].filter((id) => beforeSet.has(id));
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
        beforeCommitId,
        afterCommitId,
        beforeSelfMs: round(before.totalSelfTime),
        afterSelfMs: round(after.totalSelfTime),
        deltaSelfMs: round(after.totalSelfTime - before.totalSelfTime),
        addedComponentIds: added,
        removedComponentIds: removed,
        sharedComponentIds: shared,
        citations: [...added, ...removed].slice(0, 5).map((id) => componentRef(id)),
      };
    },

    query_events: ({ type, componentId, interactionId, cursor, limit = 25 }) => {
      const capped = Math.min(Math.max(limit, 1), 50);
      const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
      let events = store.allEvents();
      if (type) events = events.filter((e) => e.type === type);
      if (componentId != null) {
        events = events.filter(
          (e) => "componentId" in e && (e as { componentId?: number }).componentId === componentId,
        );
      }
      if (interactionId) {
        const num = interactionId.startsWith("i")
          ? Number(interactionId.slice(1))
          : Number(interactionId);
        events = events.filter(
          (e) => e.interactionId != null && (e.interactionId as unknown as number) === num,
        );
      }
      const page = events.slice(offset, offset + capped).map((e) => ({
        id: e.id as number,
        type: e.type,
        timestampMs: round(e.timestamp),
        ...("componentId" in e && e.componentId != null
          ? { componentId: e.componentId as number }
          : {}),
        ...(e.interactionId != null ? { interactionId: e.interactionId as unknown as number } : {}),
      }));
      const next = offset + capped < events.length ? String(offset + capped) : null;
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
        events: page,
        nextCursor: next,
        truncated: next != null,
        ...(next
          ? {
              budgetNote: `Showing ${page.length} of ${events.length} events; pass cursor="${next}" for more.`,
            }
          : {}),
        citations: [],
      };
    },

    get_source_location: ({ lensId }) => {
      const trimmed = lensId.trim().replace(/^\[|\]$/g, "");
      const m = /^(component|render|interaction):(.+)$/.exec(trimmed);
      if (!m) {
        return {
          error: `unrecognized lensId "${lensId}" — expected component:N, render:N, or interaction:iN`,
        };
      }
      const kind = m[1] as "component" | "render" | "interaction";
      const raw = m[2]!;
      if (kind === "component") {
        const id = Number(raw) as ComponentId;
        const inst = store.instance(id);
        if (!inst) return { error: `Unknown componentId ${raw}` };
        return {
          schemaVersion: TOOL_SCHEMA_VERSION,
          lensId: trimmed,
          kind,
          file: inst.source?.file ?? null,
          line: inst.source?.line ?? null,
          column: inst.source?.column ?? null,
          componentId: id,
          citations: [componentRef(id)],
        };
      }
      if (kind === "render") {
        const render = store.getRender(Number(raw) as RenderId);
        if (!render) return { error: `Unknown renderId ${raw}` };
        const inst = store.instance(render.componentId);
        return {
          schemaVersion: TOOL_SCHEMA_VERSION,
          lensId: trimmed,
          kind,
          file: inst?.source?.file ?? null,
          line: inst?.source?.line ?? null,
          column: inst?.source?.column ?? null,
          componentId: render.componentId,
          citations: [
            {
              kind: "render" as const,
              id: render.renderId,
              label: `render ${render.renderId}`,
              componentId: render.componentId,
            },
            componentRef(render.componentId),
          ],
        };
      }
      const it = store.interactions().find((i) => i.id === raw || i.id === `i${raw}`);
      if (!it) return { error: `Unknown interaction ${raw}` };
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
        lensId: trimmed,
        kind,
        file: null,
        line: null,
        column: null,
        citations: [{ kind: "interaction" as const, id: it.id, label: it.label }],
      };
    },

    diagnose_slowness: ({ interactionId }) => {
      const ranked = store
        .interactions()
        .slice()
        .sort((a, b) => b.metrics.reactDuration - a.metrics.reactDuration);
      const it = (interactionId ? ranked.find((i) => i.id === interactionId) : null) ?? ranked[0];
      if (!it) {
        return { error: "no interaction recorded yet — interact with the page first" };
      }
      const narrative = explainInteraction(store, causality, it, { diagnose });
      const top = narrative.topCost[0];
      const findings = [
        {
          kind: "interaction-cost",
          label: it.label,
          detail: `${round(it.metrics.reactDuration)}ms React / ${it.metrics.renderCount} renders`,
          lensId: `interaction:${it.id}`,
          nextStep: "explain_interaction",
        },
        ...(top
          ? [
              {
                kind: "top-cost-component",
                label: top.name,
                detail: `${round(top.self)}ms self${top.wasted ? " (wasted)" : ""}`,
                lensId: `component:${top.componentId}`,
                nextStep: "why / read_component_source",
              },
            ]
          : []),
        ...narrative.waste.slice(0, 3).map((w) => ({
          kind: "waste",
          label: w.name,
          detail: `${round(w.self)}ms no-observable-change`,
          lensId: `render:${w.renderId}`,
          nextStep: "why",
        })),
      ];
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
        verdict: narrative.headline,
        findings,
        citations: narrative.citations,
        nextSteps: [
          `explain_interaction({ interactionId: "${it.id}" })`,
          ...(top
            ? [
                `why({ renderId: ${top.renderId} })`,
                `read_component_source({ componentId: ${top.componentId} })`,
              ]
            : []),
        ],
      };
    },

    find_wasted_renders: ({ limit = 10 }) => {
      const waste: Array<{
        componentId: ComponentId;
        name: string;
        renderId: RenderId;
        selfMs: number;
      }> = [];
      for (const inst of store.allInstances()) {
        for (const r of store.rendersOf(inst.id)) {
          try {
            if (causality.why(r.renderId).verdict !== "no-observable-change") continue;
            waste.push({
              componentId: inst.id,
              name: inst.name,
              renderId: r.renderId,
              selfMs: round(r.selfDuration),
            });
          } catch {
            /* skip */
          }
        }
      }
      waste.sort((a, b) => b.selfMs - a.selfMs);
      const top = waste.slice(0, limit);
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
        verdict:
          top.length === 0
            ? "No wasted (no-observable-change) renders in retained history."
            : `${top.length} wasted renders; top is ${top[0]!.name} at ${top[0]!.selfMs}ms.`,
        findings: top.map((w) => ({
          kind: "waste",
          label: w.name,
          detail: `${w.selfMs}ms`,
          lensId: `render:${w.renderId}`,
          nextStep: `why({ renderId: ${w.renderId} })`,
        })),
        citations: top.slice(0, 5).map((w) => componentRef(w.componentId)),
        nextSteps: top
          .slice(0, 2)
          .flatMap((w) => [
            `why({ renderId: ${w.renderId} })`,
            `read_component_source({ componentId: ${w.componentId} })`,
          ]),
      };
    },

    why_did_component_render: ({ componentId }) => {
      const id = componentId as ComponentId;
      const instance = store.instance(id);
      if (!instance) {
        return { error: `Unknown componentId ${componentId} — use find_component to look it up.` };
      }
      const retained = store
        .rendersOf(id)
        .slice()
        .sort((a, b) => b.selfDuration - a.selfDuration);
      const worst = retained[0];
      if (!worst) {
        return { error: `No retained renders for component ${instance.name}` };
      }
      const why = causality.why(worst.renderId);
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
        verdict: `${instance.name}: ${why.verdict} on render ${worst.renderId} (${round(worst.selfDuration)}ms)`,
        findings: [
          {
            kind: "verdict",
            label: why.verdict,
            detail: why.observableOutputChanged
              ? "observable output changed"
              : "no observable output change",
            lensId: `render:${worst.renderId}`,
            nextStep: "read_component_source on cause site",
          },
          ...why.causes.slice(0, 3).map((c) => ({
            kind: `cause-L${c.level}`,
            label: c.explanation,
            detail: `confidence ${c.confidence}`,
            nextStep: c.sourceLocation
              ? `${c.sourceLocation.file}:${c.sourceLocation.line}`
              : "read_component_source",
          })),
        ],
        citations: [
          componentRef(id),
          {
            kind: "render" as const,
            id: worst.renderId,
            label: `render ${worst.renderId}`,
            componentId: id,
          },
        ],
        nextSteps: [
          `why({ renderId: ${worst.renderId} })`,
          `read_component_source({ componentId: ${id} })`,
          `component_runtime({ componentId: ${id} })`,
        ],
      };
    },

    compare_sessions: ({ before, after }) => {
      const beforePayload = before as EventsBatchMessage["payload"];
      const afterPayload = after as EventsBatchMessage["payload"];
      if (!beforePayload?.events || !afterPayload?.events) {
        return { error: "before and after must be session payloads with events[]" };
      }
      const result = compareSessions(beforePayload, afterPayload);
      return {
        schemaVersion: TOOL_SCHEMA_VERSION,
        verdict: result.verdict,
        regressions: result.regressions.map((r) => ({
          name: r.name,
          beforeRenderCount: r.beforeRenderCount,
          afterRenderCount: r.afterRenderCount,
          renderDeltaPct: r.renderDeltaPct,
          wasteDelta: r.wasteDelta,
        })),
        improvements: result.improvements.map((r) => ({
          name: r.name,
          renderDelta: r.renderDelta,
          wasteDelta: r.wasteDelta,
        })),
        onlyBefore: result.onlyBefore,
        onlyAfter: result.onlyAfter,
        citations: [],
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
): Promise<{
  content: { path: string; content: string };
  span: { startLine: number; endLine: number };
} | null> {
  const importRe = new RegExp(
    `import\\s+(?:[^;'"]*[\\s{,])?${escapeRe(name)}[\\s,}][^;'"]*from\\s+["']([^"']+)["']`,
  );
  const match = importRe.exec(creationSource);
  const specifier = match?.[1];
  if (!specifier || !specifier.startsWith(".")) return null;

  const bare = specifier.replace(/\.(js|jsx|ts|tsx)$/, "");
  const candidates = [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"].map(
    (ext) => bare + ext,
  );
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

/**
 * Latest render caused by a function-identity-only prop change — the classic
 * inline-arrow signature. Mirrors the Doctor's heuristic (apps/devtools).
 */
function hasFunctionPropChurn(causality: Causality, renderId: RenderId | undefined): boolean {
  if (renderId === undefined) return false;
  try {
    const why = causality.why(renderId);
    return why.causes.some((c) => {
      if (!c.diff) return false;
      const fn = c.diff.changes.some((ch) => ch.kind === "FUNCTION_IDENTITY_CHANGED");
      const value = c.diff.changes.some((ch) => ch.kind === "VALUE_CHANGED");
      return fn && !value;
    });
  } catch {
    return false;
  }
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
      ? {
          topChanges: changes.slice(0, 5).map((ch) => ({ path: ch.path.join("."), kind: ch.kind })),
        }
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
