import { useState, useEffect } from "react";
import { Section, DiffLines } from "@react-lens/ui";
import type { TraceStore } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId, RenderId, RenderSnapshot } from "@react-lens/protocol";
import { diff, type DiffResult } from "@react-lens/diff-engine";
import { useTraceVersion } from "./useLens.js";
import { ms, shortSource } from "@react-lens/ui";
import type { TimeCursor, ABMarks } from "./timeCursor.js";
import { WhySection } from "./tabs/OverviewTab.js";
import { PropsTab } from "./tabs/PropsTab.js";
import { StateTab } from "./tabs/StateTab.js";
import { HooksTab } from "./tabs/HooksTab.js";
import { ContextTab } from "./tabs/ContextTab.js";
import { EffectsTab } from "./tabs/EffectsTab.js";
import { RendersTab } from "./tabs/RendersTab.js";
import { SourceTab } from "./tabs/SourceTab.js";
import { DomTab } from "./tabs/DomTab.js";
import { RelationsTab } from "./tabs/RelationsTab.js";
import { DoctorTab } from "./tabs/DoctorTab.js";
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
 * Single dense scroll of collapsible sections — no tabs. Sections with no data
 * for the current component are hidden entirely, so what you see is only what
 * exists. Order is by debugging priority: why first, then props/state/hooks.
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
}) {
  useTraceVersion(store, { kind: "component", id: componentId });
  const inst = store.instance(componentId);
  const renders = store.rendersOf(componentId);
  const [selectedRender, setSelectedRender] = useState<RenderId | null>(null);

  const latest = renders.at(-1);
  useEffect(() => {
    if (latest) setSelectedRender(latest.renderId);
  }, [latest?.renderId]);

  // Time travel: when the global cursor is historical, show this component's
  // render at that moment (redesign §30); otherwise the manually-selected/latest.
  const historical = cursor?.mode === "historical";
  const historicalRenderId = historical
    ? store.renderAtOrBefore(componentId, cursor.t)?.renderId ?? null
    : null;
  const activeRenderId = historical ? historicalRenderId : selectedRender ?? latest?.renderId ?? null;

  // When snapshots aren't streamed inline (large apps), fetch on demand.
  const hasSnapshot = activeRenderId !== null && store.snapshot(activeRenderId) !== undefined;
  useEffect(() => {
    if (onRequestSnapshot && activeRenderId !== null && !hasSnapshot) {
      onRequestSnapshot(activeRenderId);
    }
  }, [onRequestSnapshot, activeRenderId, hasSnapshot]);

  const doctor = useDoctor(store, causality, componentId);

  if (!inst) return <div className="rl-empty">Component no longer mounted.</div>;

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

  const abDiff =
    ab?.a != null && ab?.b != null ? compareAB(store, componentId, ab.a, ab.b) : null;

  const hooks = snapshot?.hooks ?? [];
  const propCount = snapshot?.props.k === "object" ? (snapshot.props.entries?.length ?? 0) : 0;
  const stateCount = hooks.filter((h) => h.kind === "state" || h.kind === "reducer").length;
  const effectCount = hooks.filter((h) => h.kind === "effect" || h.kind === "layout-effect").length;
  const contextCount = snapshot?.contexts?.length ?? 0;

  return (
    <div className="rl-inspector">
      <div className="rl-insp-head">
        <h2>{inst.name}</h2>
        <span className={`rl-badge ${inst.compiler.compiled ? "healthy" : "dim"}`}>
          {inst.compiler.compiled ? "◆ compiled" : "not compiled"}
        </span>
        {inst.kind === "server-boundary" && (
          <span className="rl-badge render" title={rscTitle(inst)}>
            {inst.rsc?.role === "server-reference"
              ? "server action"
              : inst.rsc?.role === "lazy-payload"
                ? "RSC lazy"
                : "RSC boundary"}
            {inst.rsc?.exportName ? ` · ${inst.rsc.exportName}` : ""}
          </span>
        )}
        {inst.kind === "suspense" && (
          <span className={`rl-badge ${inst.suspended ? "warn" : "dim"}`}>
            Suspense{inst.suspended ? " · fallback" : ""}
          </span>
        )}
        {inst.underSuspense && inst.kind !== "suspense" && (
          <span className={`rl-badge ${inst.suspended ? "warn" : "dim"}`}>
            ◇ {inst.suspended ? "suspended" : "under Suspense"}
          </span>
        )}
        {historical && <span className="rl-badge warn">◷ historical</span>}
      </div>
      <div className="rl-source">
        {inst.source ? `${shortSource(inst.source.file)}:${inst.source.line}` : "source unavailable"}
        {" · "}
        {store.renderCount(componentId)} renders · {ms(store.selfTimeTotal(componentId))}
      </div>

      {historical && activeRenderId === null && (
        <div className="rl-empty">Not yet rendered at this point in time.</div>
      )}

      {abDiff && (
        <Section title="Compare A ↔ B" defaultOpen>
          <ABCompare diff={abDiff} />
        </Section>
      )}

      <Section title="Why this render" defaultOpen>
        <WhySection ctx={ctx} />
      </Section>

      {doctor.total > 0 && (
        <Section title="Doctor" count={doctor.total} defaultOpen>
          <DoctorTab runtime={doctor.runtime} staticFindings={doctor.staticFindings} />
        </Section>
      )}

      {propCount > 0 && (
        <Section title="Props" count={propCount} defaultOpen>
          <PropsTab ctx={ctx} />
        </Section>
      )}

      {stateCount > 0 && (
        <Section title="State" count={stateCount} defaultOpen>
          <StateTab ctx={ctx} />
        </Section>
      )}

      {hooks.length > 0 && (
        <Section title="Hooks" count={hooks.length}>
          <HooksTab ctx={ctx} />
        </Section>
      )}

      {contextCount > 0 && (
        <Section title="Context" count={contextCount}>
          <ContextTab ctx={ctx} />
        </Section>
      )}

      {effectCount > 0 && (
        <Section title="Effects" count={effectCount}>
          <EffectsTab ctx={ctx} />
        </Section>
      )}

      <Section title="Relations">
        <RelationsTab ctx={ctx} />
      </Section>

      <Section title="Renders" count={renders.length}>
        <RendersTab ctx={ctx} renders={renders} />
      </Section>

      <Section title="Source">
        <SourceTab inst={inst} ctx={ctx} />
      </Section>

      {snapshot?.dom && (
        <Section title="DOM">
          <DomTab ctx={ctx} />
        </Section>
      )}
    </div>
  );
}

interface ABDiff {
  missing: "A" | "B" | "both" | null;
  props?: DiffResult;
  state?: DiffResult;
}

/** Diff a component's props/state between the A and B timestamps (§28, §164). */
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
      <div className="rl-empty">
        Snapshot not retained at {where}. Scrub there to fetch it, then set the marker again.
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

function rscTitle(inst: { rsc?: { role: string; moduleId?: string; exportName?: string } }): string {
  const r = inst.rsc;
  if (!r) return "RSC / Flight boundary";
  const parts = [r.role];
  if (r.exportName) parts.push(r.exportName);
  if (r.moduleId) parts.push(r.moduleId);
  return parts.join(" · ");
}

