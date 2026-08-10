import { useState, useEffect } from "react";
import type { TraceStore } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId, RenderId, RenderSnapshot } from "@react-lens/protocol";
import { useTraceVersion } from "./useLens.js";
import { ms } from "./format.js";
import { OverviewTab } from "./tabs/OverviewTab.js";
import { PropsTab } from "./tabs/PropsTab.js";
import { StateTab } from "./tabs/StateTab.js";
import { HooksTab } from "./tabs/HooksTab.js";
import { ContextTab } from "./tabs/ContextTab.js";
import { EffectsTab } from "./tabs/EffectsTab.js";
import { RendersTab } from "./tabs/RendersTab.js";
import { SourceTab } from "./tabs/SourceTab.js";

const TABS = [
  "Overview",
  "Props",
  "State",
  "Hooks",
  "Context",
  "Effects",
  "Renders",
  "Source",
] as const;
type Tab = (typeof TABS)[number];

export interface InspectorContext {
  store: TraceStore;
  causality: Causality;
  componentId: ComponentId;
  activeRenderId: RenderId | null;
  snapshot: RenderSnapshot | undefined;
  onSelectRender: (id: RenderId) => void;
}

export function Inspector({
  store,
  causality,
  componentId,
}: {
  store: TraceStore;
  causality: Causality;
  componentId: ComponentId;
}) {
  useTraceVersion(store, { kind: "component", id: componentId });
  const inst = store.instance(componentId);
  const renders = store.rendersOf(componentId);
  const [tab, setTab] = useState<Tab>("Overview");
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
  };

  return (
    <div className="rl-inspector">
      <h2>{inst.name}</h2>
      <div className="rl-source">
        {inst.source ? `${inst.source.file}:${inst.source.line}` : "source unavailable"}
        {" · "}
        {store.renderCount(componentId)} renders · {ms(store.selfTimeTotal(componentId))}
      </div>

      <div className="rl-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`rl-tab${tab === t ? " active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t}
            <TabCount tab={t} ctx={ctx} inst={inst} />
          </button>
        ))}
      </div>

      <div className="rl-tabpanel">
        {tab === "Overview" && <OverviewTab ctx={ctx} inst={inst} />}
        {tab === "Props" && <PropsTab ctx={ctx} />}
        {tab === "State" && <StateTab ctx={ctx} />}
        {tab === "Hooks" && <HooksTab ctx={ctx} />}
        {tab === "Context" && <ContextTab ctx={ctx} />}
        {tab === "Effects" && <EffectsTab ctx={ctx} />}
        {tab === "Renders" && <RendersTab ctx={ctx} renders={renders} />}
        {tab === "Source" && <SourceTab inst={inst} ctx={ctx} />}
      </div>
    </div>
  );
}

function TabCount({
  tab,
  ctx,
  inst,
}: {
  tab: Tab;
  ctx: InspectorContext;
  inst: { name: string };
}) {
  void inst;
  const snap = ctx.snapshot;
  let n: number | null = null;
  switch (tab) {
    case "Props":
      n = snap?.props.k === "object" ? (snap.props.entries?.length ?? 0) : null;
      break;
    case "Hooks":
      n = snap?.hooks?.length ?? null;
      break;
    case "Context":
      n = snap?.contexts?.length ?? null;
      break;
    case "State":
      n = snap?.hooks?.filter((h) => h.kind === "state" || h.kind === "reducer").length ?? null;
      break;
    case "Effects":
      n = snap?.hooks?.filter((h) => h.kind === "effect" || h.kind === "layout-effect").length ?? null;
      break;
    default:
      n = null;
  }
  if (n === null || n === 0) return null;
  return <span className="rl-tab-count">{n}</span>;
}
