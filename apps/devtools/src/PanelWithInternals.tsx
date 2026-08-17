import { useMemo, useState } from "react";
import type { ComponentId } from "@reactlens/protocol";
import type { PanelProps } from "./Panel.js";
import { Panel as CascadePanel } from "./Panel.js";
import { useTraceVersion } from "./useLens.js";
import { readFresh } from "./traceFresh.js";

export {
  configureSourceFetcher,
  getSourceResolver,
  configureComponentLocator,
  configureSourceRevealer,
} from "./Panel.js";
export type {
  ComponentLocator,
  LocatedSource,
  EditApi,
  TimeTravelApi,
  PanelProps,
} from "./Panel.js";

/**
 * Cascade remains the product surface. React internals are an X-ray layer over
 * the same causal graph instead of a competing workspace with its own tree.
 */
export function Panel(props: PanelProps) {
  const [reactLayer, setReactLayer] = useState(true);

  return (
    <>
      {/* Never wrap CascadePanel: `.rl-root` is the extension/embedded layout root. */}
      <CascadePanel {...props} />
      <ReactLayerToggle
        active={reactLayer}
        embedded={props.embedded === true}
        onToggle={() => setReactLayer((value) => !value)}
      />
      {reactLayer && <ReactExecutionLayer {...props} />}
    </>
  );
}

function ReactLayerToggle({
  active,
  embedded,
  onToggle,
}: {
  active: boolean;
  embedded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title="Toggle React execution details"
      onClick={onToggle}
      style={{
        position: "fixed",
        top: 8,
        right: embedded ? 344 : 344,
        zIndex: 2147483050,
        height: 27,
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "0 10px",
        border: `1px solid ${active ? "var(--rl-interaction)" : "var(--rl-border)"}`,
        borderRadius: 7,
        background: active ? "var(--rl-bg-active)" : "var(--rl-bg-raised)",
        color: active ? "var(--rl-text)" : "var(--rl-text-dim)",
        boxShadow: "0 5px 16px rgba(0,0,0,.14)",
        font: "600 10.5px/1 var(--rl-font)",
        cursor: "pointer",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: active ? "var(--rl-interaction)" : "var(--rl-text-faint)",
          boxShadow: active ? "0 0 0 3px color-mix(in srgb, var(--rl-interaction) 16%, transparent)" : "none",
        }}
      />
      React
    </button>
  );
}

function ReactExecutionLayer(props: PanelProps) {
  const version = useTraceVersion(props.store, { kind: "global" });
  const [selectedFiber, setSelectedFiber] = useState<ComponentId | null>(null);

  const data = readFresh(version, () => {
    const commits = props.store.commits();
    const commit = commits.at(-1) ?? null;
    const componentIds = commit?.componentIds ?? [];
    const fibers = componentIds.map((id) => {
      const instance = props.store.instance(id);
      const renders = props.store.rendersOf(id);
      const render = renders.at(-1);
      return {
        id,
        name: instance?.name ?? `#${id}`,
        parentId: instance?.parentId,
        source: instance?.source
          ? `${instance.source.file}:${instance.source.line ?? "?"}`
          : undefined,
        selfTime: render?.selfDuration ?? 0,
        totalTime: render?.totalDuration ?? 0,
        renderId: render?.renderId,
      };
    });
    return { commits, commit, fibers };
  });

  const selected = useMemo(
    () => data.fibers.find((fiber) => fiber.id === selectedFiber) ?? null,
    [data.fibers, selectedFiber],
  );
  const maxSelf = Math.max(0.001, ...data.fibers.map((fiber) => fiber.selfTime));
  const embeddedLeft = "max(calc(12vw + 284px), calc(100vw - 1180px + 284px))";

  return (
    <section
      aria-label="React execution layer"
      style={{
        position: "fixed",
        left: props.embedded ? embeddedLeft : 284,
        right: 332,
        bottom: 34,
        zIndex: 2147483040,
        minWidth: 360,
        border: "1px solid var(--rl-border-strong)",
        borderRadius: 10,
        background: "color-mix(in srgb, var(--rl-bg-raised) 94%, transparent)",
        boxShadow: "0 14px 42px rgba(0,0,0,.24)",
        backdropFilter: "blur(16px)",
        color: "var(--rl-text)",
        fontFamily: "var(--rl-font)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          minHeight: 34,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 10px",
          borderBottom: "1px solid var(--rl-border)",
        }}
      >
        <strong style={{ fontSize: 10.5, letterSpacing: ".045em", textTransform: "uppercase" }}>
          React execution
        </strong>
        {data.commit ? (
          <>
            <span style={muted}>commit #{data.commit.commitId}</span>
            <Metric value={`${data.fibers.length}`} label="fibers" />
            <Metric value={`${data.commit.totalSelfTime.toFixed(1)}ms`} label="self" />
          </>
        ) : (
          <span style={muted}>waiting for the first commit…</span>
        )}
        <span style={{ marginLeft: "auto", ...muted }}>{data.commits.length} commits captured</span>
      </div>

      {data.commit && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "82px minmax(0,1fr) 72px 76px", minHeight: 44 }}>
            <Phase label="USER" value={data.commit.interactionId !== undefined ? `#${data.commit.interactionId}` : "passive"} />
            <div style={{ padding: "7px 10px", borderRight: "1px solid var(--rl-border)" }}>
              <div style={{ ...muted, fontSize: 9, letterSpacing: ".07em" }}>RENDER WORK</div>
              <div
                style={{
                  display: "flex",
                  gap: 3,
                  alignItems: "center",
                  height: 16,
                  marginTop: 4,
                  overflow: "hidden",
                }}
              >
                {data.fibers.slice(0, 40).map((fiber) => {
                  const h = Math.max(4, 4 + (fiber.selfTime / maxSelf) * 12);
                  return (
                    <button
                      key={fiber.id}
                      type="button"
                      title={`${fiber.name} · ${fiber.selfTime.toFixed(2)}ms self`}
                      aria-label={`Inspect React work for ${fiber.name}`}
                      onClick={() => {
                        setSelectedFiber((current) => (current === fiber.id ? null : fiber.id));
                        props.onHighlight?.(fiber.id);
                      }}
                      style={{
                        flex: "1 1 4px",
                        minWidth: 3,
                        maxWidth: 14,
                        height: h,
                        alignSelf: "end",
                        padding: 0,
                        border: 0,
                        borderRadius: "2px 2px 1px 1px",
                        background:
                          selectedFiber === fiber.id ? "var(--rl-warn)" : "var(--rl-interaction)",
                        opacity: selectedFiber === fiber.id ? 1 : 0.38 + Math.min(0.5, fiber.selfTime / maxSelf),
                        cursor: "pointer",
                      }}
                    />
                  );
                })}
              </div>
            </div>
            <Phase label="COMMIT" value={`#${data.commit.commitId}`} />
            <Phase
              label="SPAN"
              value={`${Math.max(0, data.commit.endTimestamp - data.commit.timestamp).toFixed(1)}ms`}
              last
            />
          </div>

          {selected && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(150px,1.2fr) repeat(3,minmax(90px,.7fr)) minmax(180px,1.4fr)",
                gap: 0,
                borderTop: "1px solid var(--rl-border)",
                background: "var(--rl-bg)",
              }}
            >
              <DetailCell label="Fiber" value={`<${selected.name} />`} strong />
              <DetailCell label="Self" value={`${selected.selfTime.toFixed(2)} ms`} />
              <DetailCell label="Subtree" value={`${selected.totalTime.toFixed(2)} ms`} />
              <DetailCell label="Parent" value={selected.parentId !== undefined ? `#${selected.parentId}` : "root"} />
              <DetailCell label="Source" value={selected.source ?? "unavailable"} last />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "baseline" }}>
      <b style={{ font: "600 10.5px/1 var(--rl-mono)" }}>{value}</b>
      <span style={muted}>{label}</span>
    </span>
  );
}

function Phase({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{ padding: "7px 9px", borderRight: last ? 0 : "1px solid var(--rl-border)" }}>
      <div style={{ ...muted, fontSize: 8.5, letterSpacing: ".07em" }}>{label}</div>
      <div style={{ marginTop: 4, font: "600 10px/1 var(--rl-mono)", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function DetailCell({
  label,
  value,
  strong = false,
  last = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  last?: boolean;
}) {
  return (
    <div style={{ minWidth: 0, padding: "8px 10px", borderRight: last ? 0 : "1px solid var(--rl-border)" }}>
      <div style={{ ...muted, fontSize: 8.5, letterSpacing: ".06em", textTransform: "uppercase" }}>{label}</div>
      <div
        style={{
          marginTop: 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          font: `${strong ? 650 : 500} 10.5px/1.2 var(--rl-mono)`,
        }}
      >
        {value}
      </div>
    </div>
  );
}

const muted = {
  color: "var(--rl-text-dim)",
  fontSize: 9.5,
} satisfies React.CSSProperties;
