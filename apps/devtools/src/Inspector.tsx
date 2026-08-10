import { useState, useEffect } from "react";
import { Section } from "@react-lens/ui";
import type { TraceStore } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId, RenderId, RenderSnapshot } from "@react-lens/protocol";
import { useTraceVersion } from "./useLens.js";
import { ms } from "./format.js";
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
import { diagnoseOne } from "./doctor.js";

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
  edit,
  highlight,
  onSelectComponent,
}: {
  store: TraceStore;
  causality: Causality;
  componentId: ComponentId;
  edit?: EditApi;
  highlight?: (id: ComponentId | null) => void;
  onSelectComponent?: (id: ComponentId) => void;
}) {
  useTraceVersion(store, { kind: "component", id: componentId });
  const inst = store.instance(componentId);
  const renders = store.rendersOf(componentId);
  const [selectedRender, setSelectedRender] = useState<RenderId | null>(null);

  const latest = renders.at(-1);
  useEffect(() => {
    if (latest) setSelectedRender(latest.renderId);
  }, [latest?.renderId]);

  if (!inst) return <div className="rl-empty">Component no longer mounted.</div>;

  const activeRenderId = selectedRender ?? latest?.renderId ?? null;
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

  const doctorCount = diagnoseOne(store, causality, componentId).length;
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
        {inst.underSuspense && (
          <span className={`rl-badge ${inst.suspended ? "warn" : "dim"}`}>
            ◇ {inst.suspended ? "suspended" : "suspense"}
          </span>
        )}
      </div>
      <div className="rl-source">
        {inst.source ? `${inst.source.file}:${inst.source.line}` : "source unavailable"}
        {" · "}
        {store.renderCount(componentId)} renders · {ms(store.selfTimeTotal(componentId))}
      </div>

      <Section title="Why this render" defaultOpen>
        <WhySection ctx={ctx} />
      </Section>

      {doctorCount > 0 && (
        <Section title="Doctor" count={doctorCount} defaultOpen>
          <DoctorTab ctx={ctx} />
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

