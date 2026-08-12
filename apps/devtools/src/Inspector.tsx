import { useState, useEffect, type ReactNode } from "react";
import { DiffLines, ms, shortSource } from "@reactlens/ui";
import type { TraceStore } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type { ComponentId, RenderId, RenderSnapshot } from "@reactlens/protocol";
import { diff, type DiffResult } from "@reactlens/diff-engine";
import { useTraceVersion } from "./useLens.js";
import type { TimeCursor, ABMarks } from "./timeCursor.js";
import { WhySection } from "./tabs/OverviewTab.js";
import { PropsTab } from "./tabs/PropsTab.js";
import { StateTab } from "./tabs/StateTab.js";
import { ContextTab } from "./tabs/ContextTab.js";
import { EffectsTab } from "./tabs/EffectsTab.js";
import { RendersTab } from "./tabs/RendersTab.js";
import { SourceTab } from "./tabs/SourceTab.js";
import { DomTab } from "./tabs/DomTab.js";
import { RelationsTab } from "./tabs/RelationsTab.js";
import { DoctorTab } from "./tabs/DoctorTab.js";
import { openResolvedInEditor } from "./openInEditor.js";
import { revealSource } from "./revealSource.js";
import { getSourceResolver } from "./sourceResolver.js";
import { useLocatedSource } from "./useLocatedSource.js";
import { diagnosticFixPrompt } from "./perfBudget.js";
import { useDoctor } from "./useDoctor.js";

export interface EditApi {
  setProp(componentId: ComponentId, path: Array<string | number>, value: unknown): void;
  setHookState(
    componentId: ComponentId,
    hookIndex: number,
    path: Array<string | number>,
    value: unknown,
  ): void;
}

export interface InspectorContext {
  store: TraceStore;
  causality: Causality;
  componentId: ComponentId;
  activeRenderId: RenderId | null;
  snapshot: RenderSnapshot | undefined;
  onSelectRender: (id: RenderId) => void;
  /** Navigate the inspector to another component (Relations links). */
  onSelectComponent?: (id: ComponentId) => void;
  /** Present only when live editing is available (embedded, dev build). */
  edit?: EditApi;
  /** Highlight this component's DOM on the page (embedded only). */
  highlight?: (id: ComponentId | null) => void;
}

/**
 * Component inspector: same numbered-section chrome as clip inspection
 * (no accordions) — Props → State → Context → Effects → Stack → Renders →
 * Source → DOM.
 */
export function Inspector({
  store,
  causality,
  componentId,
  cursor,
  ab,
  edit,
  highlight,
  onSelectComponent,
  onRequestSnapshot,
  onAskAI,
  headAction,
}: {
  store: TraceStore;
  causality: Causality;
  componentId: ComponentId;
  cursor?: TimeCursor;
  ab?: ABMarks;
  edit?: EditApi;
  highlight?: (id: ComponentId | null) => void;
  onSelectComponent?: (id: ComponentId) => void;
  onRequestSnapshot?: (renderId: RenderId) => void;
  /** Ask the AI drawer a targeted question (doctor Fix-with-AI). */
  onAskAI?: (question: string) => void;
  /** Trailing control in the column heading — the shell's collapse toggle. */
  headAction?: ReactNode;
}) {
  useTraceVersion(store, { kind: "component", id: componentId });
  const inst = store.instance(componentId);
  const renders = store.rendersOf(componentId);
  const [selectedRender, setSelectedRender] = useState<RenderId | null>(null);

  const latest = renders.at(-1);
  useEffect(() => {
    if (latest) setSelectedRender(latest.renderId);
  }, [latest?.renderId]);

  const historical = cursor?.mode === "historical";
  const historicalRenderId = historical
    ? (store.renderAtOrBefore(componentId, cursor.t)?.renderId ?? null)
    : null;
  const activeRenderId = historical
    ? historicalRenderId
    : (selectedRender ?? latest?.renderId ?? null);

  const hasSnapshot = activeRenderId !== null && store.snapshot(activeRenderId) !== undefined;
  useEffect(() => {
    if (onRequestSnapshot && activeRenderId !== null && !hasSnapshot) {
      onRequestSnapshot(activeRenderId);
    }
  }, [onRequestSnapshot, activeRenderId, hasSnapshot]);

  const doctor = useDoctor(store, causality, componentId);
  // Production builds carry no React-provided source; locate it in the bundle.
  const located = useLocatedSource(componentId, inst?.source);

  if (!inst) {
    return (
      <>
        <div className="colhead">
          Inspector
          {headAction}
        </div>
        <div className="isect why">Component no longer mounted.</div>
      </>
    );
  }

  const snapshot = activeRenderId !== null ? store.snapshot(activeRenderId) : undefined;

  const ctx: InspectorContext = {
    store,
    causality,
    componentId,
    activeRenderId,
    snapshot,
    onSelectRender: setSelectedRender,
    ...(edit ? { edit } : {}),
    ...(highlight ? { highlight } : {}),
    ...(onSelectComponent ? { onSelectComponent } : {}),
  };

  const abDiff = ab?.a != null && ab?.b != null ? compareAB(store, componentId, ab.a, ab.b) : null;

  const hooks = snapshot?.hooks ?? [];
  const propCount = snapshot?.props.k === "object" ? (snapshot.props.entries?.length ?? 0) : 0;
  const stateCount = hooks.filter((h) => h.kind === "state" || h.kind === "reducer").length;
  const effectCount = hooks.filter((h) => h.kind === "effect" || h.kind === "layout-effect").length;
  const contextCount = snapshot?.contexts?.length ?? 0;
  const renderCount = store.renderCount(componentId);
  const selfTotal = store.selfTimeTotal(componentId);
  const activeSelf =
    activeRenderId != null ? store.getRender(activeRenderId)?.selfDuration : undefined;
  const displayName = located?.originalName ?? inst.name;

  let n = 0;
  const next = () => ++n;

  return (
    <>
      <div className="colhead">
        Inspector
        {headAction}
      </div>

      <div className="rl-insp-head">
        <h2>{displayName}</h2>
        {located?.originalName && located.originalName !== inst.name && (
          <span className="rl-chip dim" title={`Minified as ${inst.name}`}>
            {inst.name}
          </span>
        )}
        {historical && <span className="rl-chip warn">historical</span>}
        {inst.compiler.compiled && (
          <span className="rl-chip healthy" title="React Compiler optimized">
            compiled
          </span>
        )}
        {inst.kind === "server-boundary" && (
          <span className="rl-chip render" title={rscTitle(inst)}>
            {inst.rsc?.role === "server-reference"
              ? "server action"
              : inst.rsc?.role === "lazy-payload"
                ? "RSC lazy"
                : "RSC"}
          </span>
        )}
        {(inst.kind === "suspense" || inst.underSuspense) && (
          <span className={`rl-chip ${inst.suspended ? "warn" : "dim"}`}>
            {inst.suspended ? "suspended" : "Suspense"}
          </span>
        )}
      </div>

      <div className="crumb" onMouseLeave={() => highlight?.(null)}>
        {ownerChain(store, componentId).map((step, i, all) => (
          <span key={step.id}>
            {i > 0 && " › "}
            {i === all.length - 1 ? (
              <b>{step.name}</b>
            ) : (
              <span
                role="button"
                tabIndex={0}
                onClick={() => onSelectComponent?.(step.id)}
                onMouseEnter={() => highlight?.(step.id)}
                onKeyDown={(e) => e.key === "Enter" && onSelectComponent?.(step.id)}
              >
                {step.name}
              </span>
            )}
          </span>
        ))}
      </div>

      <div className="isect why">
        <div className="plegend" style={{ marginBottom: 8 }}>
          <span>
            renders <em>{renderCount}</em>
          </span>
          <span>
            total <em>{ms(selfTotal)}</em>
          </span>
          {activeSelf != null && (
            <span>
              this <em>{ms(activeSelf)}</em>
            </span>
          )}
          {doctor.total > 0 && (
            <span>
              issues <em>{doctor.total}</em>
            </span>
          )}
        </div>
        {inst.source ? (
          <button
            type="button"
            className="rl-insp-source rl-insp-source-link"
            title="Open in editor"
            onClick={() => {
              const src = inst.source!;
              void getSourceResolver()
                .resolve(src)
                .then((loc) => openResolvedInEditor(src, loc));
            }}
          >
            {shortSource(inst.source.file)}:{inst.source.line}
          </button>
        ) : located ? (
          <button
            type="button"
            className="rl-insp-source rl-insp-source-link"
            title={
              located.original
                ? `Open in editor · ${located.original.file}:${located.original.line}`
                : `Bundled at ${located.compiled.file}:${located.compiled.line} — deploy source maps for original paths`
            }
            onClick={() => void revealSource(located.compiled, located.original ?? null)}
          >
            {shortSource((located.original ?? located.compiled).file)}:
            {(located.original ?? located.compiled).line}
          </button>
        ) : (
          <span className="rl-insp-source">no source</span>
        )}
      </div>

      {historical && activeRenderId === null && (
        <div className="isect why">Not rendered yet at this cursor.</div>
      )}

      {abDiff && (
        <div className="isect">
          <div className="ihead">Compare A ↔ B</div>
          <ABCompare diff={abDiff} />
        </div>
      )}

      <div className="isect">
        <div className="ihead">
          <span className="n">{next()}</span>Why
        </div>
        <WhySection ctx={ctx} />
      </div>

      {doctor.total > 0 && (
        <div className="isect">
          <div className="ihead">
            <span className="n">{next()}</span>Doctor
            <span className="right">{doctor.total}</span>
          </div>
          <DoctorTab
            runtime={doctor.runtime}
            staticFindings={doctor.staticFindings}
            {...(onAskAI
              ? {
                  onFixWithAI: (f: { title: string; detail: string }) =>
                    onAskAI(
                      diagnosticFixPrompt(inst.name, componentId as number, f.title, f.detail),
                    ),
                }
              : {})}
          />
        </div>
      )}

      <div className="isect">
        <div className="ihead">
          <span className="n">{next()}</span>Props
          {propCount > 0 && <span className="right">{propCount}</span>}
        </div>
        {propCount > 0 ? <PropsTab ctx={ctx} /> : <SectionEmpty>No props</SectionEmpty>}
      </div>

      <div className="isect">
        <div className="ihead">
          <span className="n">{next()}</span>State
          {stateCount > 0 && <span className="right">{stateCount}</span>}
        </div>
        {stateCount > 0 ? <StateTab ctx={ctx} /> : <SectionEmpty>No state hooks</SectionEmpty>}
      </div>

      <div className="isect">
        <div className="ihead">
          <span className="n">{next()}</span>Context
          {contextCount > 0 && <span className="right">{contextCount}</span>}
        </div>
        {contextCount > 0 ? (
          <ContextTab ctx={ctx} />
        ) : (
          <SectionEmpty>No context reads</SectionEmpty>
        )}
      </div>

      <div className="isect">
        <div className="ihead">
          <span className="n">{next()}</span>Effects
          {effectCount > 0 && <span className="right">{effectCount}</span>}
        </div>
        {effectCount > 0 ? <EffectsTab ctx={ctx} /> : <SectionEmpty>No effects</SectionEmpty>}
      </div>

      <div className="isect">
        <div className="ihead">
          <span className="n">{next()}</span>Stack
        </div>
        <RelationsTab ctx={ctx} />
      </div>

      <div className="isect">
        <div className="ihead">
          <span className="n">{next()}</span>Renders
          {renders.length > 0 && <span className="right">{renders.length}</span>}
        </div>
        <RendersTab ctx={ctx} renders={renders} />
      </div>

      <div className="isect">
        <div className="ihead">
          <span className="n">{next()}</span>Source
        </div>
        <SourceTab inst={inst} ctx={ctx} />
      </div>

      <div className="isect" style={{ borderBottom: "none" }}>
        <div className="ihead">
          <span className="n">{next()}</span>DOM
        </div>
        {snapshot?.dom ? <DomTab ctx={ctx} /> : <SectionEmpty>No DOM snapshot</SectionEmpty>}
      </div>
    </>
  );
}

/** Quiet placeholder so empty sections hold their place without noise. */
function SectionEmpty({ children }: { children: React.ReactNode }) {
  return <div className="rl-section-empty">{children}</div>;
}

/** Owner chain root-first, capped so a 14-deep tree doesn't wrap forever. */
function ownerChain(store: TraceStore, id: ComponentId): Array<{ id: ComponentId; name: string }> {
  const chain: Array<{ id: ComponentId; name: string }> = [];
  const seen = new Set<ComponentId>();
  let cur: ComponentId | undefined = id;
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur);
    const inst = store.instance(cur);
    if (!inst) break;
    chain.unshift({ id: cur, name: inst.name });
    cur = inst.parentId;
  }
  return chain.length > 5 ? chain.slice(-5) : chain;
}

interface ABDiff {
  missing: "A" | "B" | "both" | null;
  props?: DiffResult;
  state?: DiffResult;
}

function compareAB(store: TraceStore, id: ComponentId, a: number, b: number): ABDiff {
  const sa = store.snapshotAtOrBefore(id, a);
  const sb = store.snapshotAtOrBefore(id, b);
  if (!sa && !sb) return { missing: "both" };
  if (!sa) return { missing: "A" };
  if (!sb) return { missing: "B" };
  const undef = { k: "undefined" } as const;
  return {
    missing: null,
    props: diff({ kind: "props", before: sa.props ?? undef, after: sb.props ?? undef }),
    state: diff({ kind: "state", before: sa.state ?? undef, after: sb.state ?? undef }),
  };
}

function ABCompare({ diff: d }: { diff: ABDiff }) {
  if (d.missing) {
    const where = d.missing === "both" ? "A and B" : d.missing;
    return (
      <div className="rl-empty rl-empty-compact">
        Snapshot missing at {where}. Scrub there, then set the marker again.
      </div>
    );
  }
  return (
    <div className="rl-ab">
      <div className="rl-ab-label">Props</div>
      <DiffLines result={d.props!} />
      <div className="rl-ab-label">State</div>
      <DiffLines result={d.state!} />
    </div>
  );
}

function rscTitle(inst: {
  rsc?: { role: string; moduleId?: string; exportName?: string };
}): string {
  const r = inst.rsc;
  if (!r) return "RSC / Flight boundary";
  const parts = [r.role];
  if (r.exportName) parts.push(r.exportName);
  if (r.moduleId) parts.push(r.moduleId);
  return parts.join(" · ");
}
