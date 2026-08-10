import { useState } from "react";
import type { TraceStore } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId, ComponentInstance } from "@react-lens/protocol";
import { useTraceVersion } from "./useLens.js";
import { Inspector } from "./Inspector.js";
import { ms } from "./format.js";
import "./theme.css";

export interface PanelProps {
  store: TraceStore;
  causality: Causality;
  recording: boolean;
  onToggleRecording?: () => void;
  embedded?: boolean;
}

/** Score used only for ordering the list: total self-time × render count. */
function attentionScore(store: TraceStore, id: ComponentId): number {
  return store.selfTimeTotal(id) + store.renderCount(id) * 0.1;
}

export function Panel({ store, causality, recording, onToggleRecording, embedded }: PanelProps) {
  useTraceVersion(store, { kind: "global" });
  const [selected, setSelected] = useState<ComponentId | null>(null);

  const instances = store
    .allInstances()
    .filter((i) => store.renderCount(i.id) > 0)
    .sort((a, b) => attentionScore(store, b.id) - attentionScore(store, a.id));

  const stats = store.stats();

  return (
    <div className={`rl-root${embedded ? " rl-embedded" : ""}`}>
      <div className="rl-topbar">
        <span className="rl-brand">
          <span className="rl-dot">◈</span> React Lens
        </span>
        <span className="rl-spacer" />
        <button
          className={`rl-btn rec${recording ? " active" : ""}`}
          onClick={onToggleRecording}
          title="Toggle recording (R)"
        >
          ● {recording ? "Recording" : "Paused"}
        </button>
      </div>

      <div className="rl-body">
        <div className="rl-pane">
          <div className="rl-pane-title">Components · {instances.length}</div>
          {instances.length === 0 ? (
            <div className="rl-empty">
              No renders captured yet. Interact with the page to see components appear.
            </div>
          ) : (
            instances.map((inst) => (
              <ComponentRow
                key={inst.id}
                inst={inst}
                renders={store.renderCount(inst.id)}
                selfTime={store.selfTimeTotal(inst.id)}
                selected={selected === inst.id}
                onSelect={() => setSelected(inst.id)}
              />
            ))
          )}
        </div>

        <div className="rl-pane">
          <div className="rl-pane-title">Inspector</div>
          {selected === null ? (
            <div className="rl-empty">Select a component to inspect its renders and causes.</div>
          ) : (
            <Inspector store={store} causality={causality} componentId={selected} />
          )}
        </div>
      </div>

      <div className="rl-statusbar">
        <span>{stats.events} events</span>
        <span>{stats.renders} renders</span>
        <span>{stats.components} components</span>
        <span style={{ marginLeft: "auto" }}>
          {embedded ? "embedded" : "devtools"} · protocol v1
        </span>
      </div>
    </div>
  );
}

function ComponentRow({
  inst,
  renders,
  selfTime,
  selected,
  onSelect,
}: {
  inst: ComponentInstance;
  renders: number;
  selfTime: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const suspicious = renders > 5;
  return (
    <div className={`rl-row${selected ? " rl-selected" : ""}`} onClick={onSelect}>
      <span className="rl-name">{inst.name}</span>
      {selfTime > 0 && <span className="rl-metric">{ms(selfTime)}</span>}
      <span className={`rl-badge ${suspicious ? "suspicious" : "render"}`}>×{renders}</span>
    </div>
  );
}
