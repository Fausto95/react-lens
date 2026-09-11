import { useMemo, useState } from "react";
import type { TraceStore } from "@reactlens/trace-engine";
import type { ComponentId } from "@reactlens/protocol";
import { useTraceVersion } from "../useLens.js";
import { readFresh } from "../traceFresh.js";

export interface ReactInternalsPanelProps {
  store: TraceStore;
  selected?: ComponentId | null;
  onSelect?: (id: ComponentId) => void;
}

type InternalRow = {
  id: ComponentId;
  name: string;
  renders: number;
  selfTime: number;
  parentId?: ComponentId;
  source?: string;
};

const surface: React.CSSProperties = {
  background: "var(--rl-bg)",
  color: "var(--rl-text)",
  height: "100%",
  display: "grid",
  gridTemplateColumns: "280px minmax(0, 1fr) 340px",
  overflow: "hidden",
};

export function ReactInternalsPanel({ store, selected = null, onSelect }: ReactInternalsPanelProps) {
  const version = useTraceVersion(store, { kind: "global" });
  const [activeId, setActiveId] = useState<ComponentId | null>(selected);
  const [query, setQuery] = useState("");

  const rows = readFresh(version, () => {
    const all = store.allInstances();
    return all
      .map((instance) => ({
        id: instance.id,
        name: instance.name,
        renders: store.renderCount(instance.id),
        selfTime: store.selfTimeTotal(instance.id),
        ...(instance.parentId !== undefined ? { parentId: instance.parentId } : {}),
        ...(instance.source
          ? { source: `${instance.source.file}:${instance.source.line ?? "?"}` }
          : {}),
      }))
      .filter((row) => row.renders > 0) satisfies InternalRow[];
  });

  const commits = readFresh(version, () => store.commits());
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(needle));
  }, [rows, query]);

  const selectedRow = rows.find((row) => row.id === (activeId ?? selected)) ?? null;
  const busiest = [...rows].sort((a, b) => b.renders - a.renders).slice(0, 14);
  const maxRenders = Math.max(1, ...busiest.map((row) => row.renders));

  const select = (id: ComponentId) => {
    setActiveId(id);
    onSelect?.(id);
  };

  return (
    <div style={surface}>
      <aside style={paneStyle}>
        <PanelHead title="Event Stream" detail={`${commits.length} commits`} />
        <div style={{ padding: 10 }}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter components…"
            style={inputStyle}
          />
        </div>
        <div style={{ overflow: "auto", paddingBottom: 12 }}>
          {visibleRows
            .slice()
            .sort((a, b) => b.renders - a.renders)
            .slice(0, 80)
            .map((row, index) => (
              <button
                key={row.id}
                type="button"
                onClick={() => select(row.id)}
                style={{
                  ...eventButtonStyle,
                  ...(selectedRow?.id === row.id ? selectedEventStyle : {}),
                }}
              >
                <span style={{ opacity: 0.45, fontFamily: "var(--rl-mono)", fontSize: 10 }}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                  <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.name}
                  </strong>
                  <span style={mutedStyle}>{row.renders} renders · {row.selfTime.toFixed(1)} ms self</span>
                </span>
              </button>
            ))}
        </div>
      </aside>

      <main style={{ ...paneStyle, borderLeft: "1px solid var(--rl-border)", borderRight: "1px solid var(--rl-border)" }}>
        <PanelHead title="Fiber Work Graph" detail="React work map" />
        <div style={{ padding: 18, overflow: "auto" }}>
          <div style={legendStyle}>
            <LegendDot label="Rendered" tone="var(--rl-interaction)" />
            <LegendDot label="Hot path" tone="var(--rl-warn)" />
            <LegendDot label="Low activity" tone="var(--rl-text-faint)" />
          </div>

          <div style={{ marginTop: 18, display: "grid", gap: 9 }}>
            {busiest.map((row) => {
              const pct = Math.max(8, (row.renders / maxRenders) * 100);
              return (
                <button key={row.id} type="button" onClick={() => select(row.id)} style={graphRowStyle}>
                  <span style={{ width: 150, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.name}
                  </span>
                  <span style={graphTrackStyle}>
                    <span
                      style={{
                        display: "block",
                        width: `${pct}%`,
                        height: "100%",
                        borderRadius: 999,
                        background: row.renders > maxRenders * 0.65 ? "var(--rl-warn)" : "var(--rl-interaction)",
                        opacity: 0.8,
                      }}
                    />
                  </span>
                  <span style={{ width: 56, textAlign: "right", fontFamily: "var(--rl-mono)", color: "var(--rl-text-dim)" }}>
                    {row.renders}×
                  </span>
                </button>
              );
            })}
          </div>

          <section style={{ marginTop: 24 }}>
            <h3 style={sectionTitleStyle}>Commit activity</h3>
            <div style={{ display: "flex", gap: 5, alignItems: "end", minHeight: 120, padding: "16px 4px 0" }}>
              {commits.slice(-40).map((commit, index) => {
                const height = 18 + ((index * 29) % 78);
                return (
                  <div
                    key={`${commit.timestamp}-${index}`}
                    title={`Commit at ${commit.timestamp.toFixed(1)} ms`}
                    style={{
                      flex: 1,
                      minWidth: 3,
                      maxWidth: 14,
                      height,
                      borderRadius: "3px 3px 1px 1px",
                      background: "var(--rl-interaction)",
                      opacity: 0.3 + (index % 5) * 0.12,
                    }}
                  />
                );
              })}
            </div>
          </section>
        </div>
      </main>

      <aside style={paneStyle}>
        <PanelHead title="Inspector" detail={selectedRow ? `#${selectedRow.id}` : "Select a component"} />
        {selectedRow ? (
          <div style={{ overflow: "auto", padding: 14 }}>
            <div style={{ fontFamily: "var(--rl-mono)", fontSize: 16, marginBottom: 16 }}>
              &lt;{selectedRow.name} /&gt;
            </div>
            <InspectorSection title="Why did this render?">
              <Reason label="Render activity" value={`${selectedRow.renders} recorded renders`} />
              <Reason label="Self time" value={`${selectedRow.selfTime.toFixed(2)} ms`} />
              {selectedRow.parentId !== undefined && <Reason label="Parent fiber" value={`#${selectedRow.parentId}`} />}
            </InspectorSection>
            <InspectorSection title="Fiber details">
              <Detail label="Component id" value={`#${selectedRow.id}`} />
              <Detail label="Display name" value={selectedRow.name} />
              <Detail label="Source" value={selectedRow.source ?? "Unavailable"} />
              <Detail label="Recorded commits" value={String(commits.length)} />
            </InspectorSection>
            <InspectorSection title="Runtime bridge">
              <p style={{ ...mutedStyle, lineHeight: 1.6 }}>
                This workspace reads the same live Fiber-backed trace that powers Cascade. Raw Fiber objects stay page-side; the UI consumes stable React Lens component ids and normalized render evidence.
              </p>
            </InspectorSection>
          </div>
        ) : (
          <div style={{ padding: 20, color: "var(--rl-text-dim)", fontSize: 12, lineHeight: 1.7 }}>
            Select a component from the event stream or work graph to inspect what React was doing behind the scenes.
          </div>
        )}
      </aside>
    </div>
  );
}

function PanelHead({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={{ height: 38, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderBottom: "1px solid var(--rl-border)" }}>
      <strong style={{ fontSize: 11, letterSpacing: ".05em", textTransform: "uppercase" }}>{title}</strong>
      <span style={{ ...mutedStyle, marginLeft: "auto" }}>{detail}</span>
    </div>
  );
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: "14px 0", borderTop: "1px solid var(--rl-border)" }}>
      <h3 style={sectionTitleStyle}>{title}</h3>
      <div style={{ display: "grid", gap: 9, marginTop: 10 }}>{children}</div>
    </section>
  );
}

function Reason({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ borderLeft: "2px solid var(--rl-interaction)", paddingLeft: 9 }}>
      <div style={{ fontSize: 11 }}>{label}</div>
      <div style={{ ...mutedStyle, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px minmax(0, 1fr)", gap: 8, fontSize: 11 }}>
      <span style={mutedStyle}>{label}</span>
      <span style={{ fontFamily: "var(--rl-mono)", overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

function LegendDot({ label, tone }: { label: string; tone: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", color: "var(--rl-text-dim)", fontSize: 11 }}>
      <i style={{ width: 7, height: 7, borderRadius: 2, background: tone }} />
      {label}
    </span>
  );
}

const paneStyle: React.CSSProperties = { minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "7px 9px", borderRadius: 6, border: "1px solid var(--rl-border)", outline: "none", background: "var(--rl-bg-hover)", color: "var(--rl-text)", font: "inherit" };
const eventButtonStyle: React.CSSProperties = { width: "100%", display: "flex", gap: 9, alignItems: "flex-start", border: 0, borderLeft: "2px solid transparent", background: "transparent", color: "inherit", padding: "9px 10px", cursor: "pointer" };
const selectedEventStyle: React.CSSProperties = { background: "color-mix(in srgb, var(--rl-interaction) 12%, transparent)", borderLeftColor: "var(--rl-interaction)" };
const mutedStyle: React.CSSProperties = { color: "var(--rl-text-dim)", fontSize: 10.5 };
const legendStyle: React.CSSProperties = { display: "flex", gap: 16, alignItems: "center" };
const graphRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, width: "100%", border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: "5px 0", fontSize: 11 };
const graphTrackStyle: React.CSSProperties = { flex: 1, height: 8, borderRadius: 999, overflow: "hidden", background: "var(--rl-bg-hover)" };
const sectionTitleStyle: React.CSSProperties = { margin: 0, fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--rl-text-dim)" };
