import { useMemo, useState } from "react";
import type { ComponentId, RenderEvent, RenderReason } from "@reactlens/protocol";
import type { PanelProps } from "./Panel.js";
import { Panel as CascadePanel } from "./Panel.js";
import { useTraceVersion } from "./useLens.js";
import { readFresh } from "./traceFresh.js";
import { buildRenderStory, type RenderStory } from "./inspector/renderStory.js";

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
 * Cascade remains the product surface. The React layer is deliberately an
 * evidence layer, not a second profiler: it surfaces the few pieces of React
 * work that change what the developer should do next.
 */
export function Panel(props: PanelProps) {
  const [reactLayer, setReactLayer] = useState(true);
  const [reactSelection, setReactSelection] = useState<ComponentId | null>(null);

  return (
    <>
      {/* Never wrap CascadePanel: `.rl-root` is the extension/embedded layout root. */}
      <CascadePanel
        {...props}
        selectComponent={reactSelection ?? props.selectComponent}
        onSelectConsumed={() => {
          if (reactSelection !== null) setReactSelection(null);
          else props.onSelectConsumed?.();
        }}
      />
      <ReactLayerToggle
        active={reactLayer}
        embedded={props.embedded === true}
        onToggle={() => setReactLayer((value) => !value)}
      />
      {reactLayer && (
        <ReactEvidenceLayer
          {...props}
          onSelect={(id) => {
            setReactSelection(id);
            props.onHighlight?.(id, { reveal: true });
          }}
        />
      )}
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
      title="Show actionable React evidence on Cascade"
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
          boxShadow: active
            ? "0 0 0 3px color-mix(in srgb, var(--rl-interaction) 16%, transparent)"
            : "none",
        }}
      />
      React
    </button>
  );
}

type FindingKind =
  | "waste"
  | "identity"
  | "compiler"
  | "context"
  | "cascade"
  | "effect"
  | "external-store"
  | "force-update";

type ReactFinding = {
  key: string;
  kind: FindingKind;
  componentId: ComponentId;
  name: string;
  headline: string;
  evidence: string[];
  action: string | null;
  score: number;
  selfMs: number;
  downstream: number;
};

function ReactEvidenceLayer({
  store,
  causality,
  embedded,
  onSelect,
}: PanelProps & { onSelect: (id: ComponentId) => void }) {
  const version = useTraceVersion(store, { kind: "global" });

  const data = readFresh(version, () => {
    const commits = store.commits();
    const commit = commits.at(-1) ?? null;
    if (!commit) return { commit: null, rendered: 0, findings: [] as ReactFinding[] };

    const findings = commit.componentIds
      .flatMap((componentId) => {
        const render = store
          .rendersOf(componentId)
          .filter((candidate) => candidate.commitId === commit.commitId)
          .at(-1);
        if (!render) return [];
        const story = buildRenderStory(store, causality, render.renderId);
        if (!story) return [];
        return findingsForRender(store, render, story);
      })
      .sort((a, b) => b.score - a.score || b.selfMs - a.selfMs)
      .slice(0, 6);

    return { commit, rendered: commit.componentIds.length, findings };
  });

  const embeddedLeft = "max(calc(12vw + 284px), calc(100vw - 1180px + 284px))";

  return (
    <section
      aria-label="Actionable React evidence"
      style={{
        position: "fixed",
        left: embedded ? embeddedLeft : 284,
        right: 332,
        bottom: 34,
        zIndex: 2147483040,
        minWidth: 420,
        maxHeight: 238,
        border: "1px solid var(--rl-border-strong)",
        borderRadius: 10,
        background: "color-mix(in srgb, var(--rl-bg-raised) 96%, transparent)",
        boxShadow: "0 14px 42px rgba(0,0,0,.24)",
        backdropFilter: "blur(16px)",
        color: "var(--rl-text)",
        fontFamily: "var(--rl-font)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          minHeight: 35,
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "6px 10px",
          borderBottom: "1px solid var(--rl-border)",
        }}
      >
        <strong style={{ fontSize: 10.5, letterSpacing: ".045em", textTransform: "uppercase" }}>
          React evidence
        </strong>
        {data.commit ? (
          <>
            <span style={muted}>commit #{data.commit.commitId}</span>
            <span style={muted}>· {data.rendered} rendered</span>
            {data.findings.length > 0 && (
              <span
                style={{
                  padding: "2px 6px",
                  borderRadius: 99,
                  background: "color-mix(in srgb, var(--rl-warn) 13%, transparent)",
                  color: "var(--rl-warn)",
                  font: "600 9px/1 var(--rl-mono)",
                }}
              >
                {data.findings.length} actionable
              </span>
            )}
          </>
        ) : (
          <span style={muted}>waiting for the first commit…</span>
        )}
        <span style={{ marginLeft: "auto", ...muted }}>click evidence → select in Cascade</span>
      </div>

      {data.commit && data.findings.length === 0 ? (
        <div style={{ padding: "14px 12px 16px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 650 }}>No suspicious React work in this commit.</div>
          <div style={{ ...muted, marginTop: 5, lineHeight: 1.55 }}>
            The renders we can explain look necessary: no no-output renders, identity churn,
            compiler bailouts, broad context fan-out, forced updates, or expensive effects were found.
          </div>
        </div>
      ) : (
        <div style={{ overflow: "auto", maxHeight: 202 }}>
          {data.findings.map((finding) => (
            <FindingRow key={finding.key} finding={finding} onSelect={onSelect} />
          ))}
        </div>
      )}
    </section>
  );
}

function findingsForRender(
  store: PanelProps["store"],
  render: RenderEvent,
  story: RenderStory,
): ReactFinding[] {
  const instance = store.instance(render.componentId);
  const name = instance?.name ?? `#${render.componentId}`;
  const changed = story.changes.filter((change) => change.kind !== "same");
  const reason = summarizeReasons(store, render);
  const common = {
    componentId: render.componentId,
    name,
    selfMs: render.selfDuration,
    downstream: story.triggered.cascadeTotal,
  };
  const findings: ReactFinding[] = [];

  if (story.wasted) {
    findings.push({
      ...common,
      key: `${render.renderId}:waste`,
      kind: "waste",
      headline: `${name} rendered but produced no observable output change.`,
      evidence: [
        reason,
        changed.length === 0
          ? "Props, state and consumed context are unchanged."
          : `${changed.length} captured value ${changed.length === 1 ? "change" : "changes"}, but output stayed the same.`,
        story.triggered.cascadeTotal > 0
          ? `It still sits above ${story.triggered.cascadeTotal} downstream render${story.triggered.cascadeTotal === 1 ? "" : "s"}.`
          : "It did not cause additional downstream renders.",
      ],
      action: story.fix.kind !== "none" ? story.fix.text : "This render is a candidate to stop at its source.",
      score: 120 + story.triggered.cascadeTotal * 3 + render.selfDuration,
    });
  }

  if (story.refWarning) {
    findings.push({
      ...common,
      key: `${render.renderId}:identity`,
      kind: "identity",
      headline: story.refWarning,
      evidence: [
        ...changed.slice(0, 4).map((change) => change.text),
        "Structurally equal values with new references defeat memoized consumers.",
      ],
      action: story.fix.kind !== "none" ? story.fix.text : "Stabilize the value at the producer.",
      score: 110 + story.triggered.cascadeTotal * 2 + render.selfDuration,
    });
  }

  const compilerReason =
    render.reasons.find((item) => item.type === "compiler-bailout")?.reason ??
    render.compiler.bailoutReason;
  if (compilerReason) {
    findings.push({
      ...common,
      key: `${render.renderId}:compiler`,
      kind: "compiler",
      headline: `React Compiler could not memoize ${name}.`,
      evidence: [compilerReason, reason],
      action: "Inspect the bailout reason before adding manual memoization.",
      score: 105 + story.triggered.cascadeTotal * 2 + render.selfDuration,
    });
  }

  const contextReason = render.reasons.find((item) => item.type === "context");
  if (contextReason && story.triggered.cascadeTotal >= 2) {
    findings.push({
      ...common,
      key: `${render.renderId}:context`,
      kind: "context",
      headline: `A context update reached ${name} and fanned out through ${story.triggered.cascadeTotal} downstream renders.`,
      evidence: [reason, ...changed.filter((change) => change.path.startsWith("context.")).slice(0, 3).map((change) => change.text)],
      action: story.fix.kind !== "none" ? story.fix.text : "Narrow the subscription or stabilize the provider value.",
      score: 90 + story.triggered.cascadeTotal * 4 + render.selfDuration,
    });
  }

  if (story.cause === "cascade" && changed.length === 0 && !story.wasted) {
    findings.push({
      ...common,
      key: `${render.renderId}:cascade`,
      kind: "cascade",
      headline: `${name} woke up only because its parent rendered.`,
      evidence: [reason, "No own props/state/context change was captured."],
      action: story.fix.kind !== "none" ? story.fix.text : "Check whether this parent boundary is broader than it needs to be.",
      score: 75 + story.triggered.cascadeTotal * 2 + render.selfDuration,
    });
  }

  if (render.reasons.some((item) => item.type === "external-store")) {
    findings.push({
      ...common,
      key: `${render.renderId}:store`,
      kind: "external-store",
      headline: `${name} rendered because an external-store subscription invalidated it.`,
      evidence: [reason, ...changed.slice(0, 3).map((change) => change.text)],
      action: "Check selector granularity and whether the subscribed slice actually changed.",
      score: 80 + story.triggered.cascadeTotal * 2 + render.selfDuration,
    });
  }

  if (render.reasons.some((item) => item.type === "force-update")) {
    findings.push({
      ...common,
      key: `${render.renderId}:force`,
      kind: "force-update",
      headline: `${name} bypassed normal change detection with a forced update.`,
      evidence: [reason],
      action: "Trace the forceUpdate caller; it prevents React from explaining the update through normal inputs.",
      score: 100 + render.selfDuration,
    });
  }

  // Effect work is useful only when it is material relative to the render. Do
  // not turn every tiny useEffect into a warning.
  if (story.cost.effects >= 0.5 && story.cost.effects >= Math.max(0.5, story.cost.render)) {
    const effectEvents = store
      .allEvents()
      .filter(
        (event) =>
          event.type === "effect" &&
          event.componentId === render.componentId &&
          event.timestamp >= render.timestamp &&
          event.timestamp <= render.timestamp + Math.max(render.totalDuration, 1) + 16,
      )
      .slice(0, 4);
    findings.push({
      ...common,
      key: `${render.renderId}:effect`,
      kind: "effect",
      headline: `${name} spent ${formatMs(story.cost.effects)} in effects after rendering.`,
      evidence:
        effectEvents.length > 0
          ? effectEvents.map(
              (event) =>
                `${event.phase}${event.hookIndex !== undefined ? ` · hook #${event.hookIndex}` : ""} · ${formatMs(event.duration)}`,
            )
          : ["Effect work is at least as expensive as this component's render work."],
      action: "Inspect the effect dependencies and move non-reactive work out of the effect when possible.",
      score: 70 + story.cost.effects * 4,
    });
  }

  return findings;
}

function summarizeReasons(store: PanelProps["store"], render: RenderEvent): string {
  if (render.reasons.length === 0) return "React did not report a specific render reason.";
  return render.reasons.map((reason) => reasonLabel(store, reason)).join(" · ");
}

function reasonLabel(store: PanelProps["store"], reason: RenderReason): string {
  switch (reason.type) {
    case "mount":
      return "mounted";
    case "props":
      return reason.changed.length > 0
        ? `props changed: ${reason.changed.join(", ")}`
        : "props changed";
    case "state":
      return `state hook #${reason.hookIndex} changed`;
    case "context":
      return "consumed context changed";
    case "parent":
      return `parent ${store.instance(reason.componentId)?.name ?? `#${reason.componentId}`} rendered`;
    case "external-store":
      return "external store invalidated subscription";
    case "force-update":
      return "forceUpdate";
    case "compiler-bailout":
      return `compiler bailout: ${reason.reason}`;
  }
}

function FindingRow({
  finding,
  onSelect,
}: {
  finding: ReactFinding;
  onSelect: (id: ComponentId) => void;
}) {
  const tone = findingTone(finding.kind);
  return (
    <button
      type="button"
      onClick={() => onSelect(finding.componentId)}
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: "78px minmax(120px, .65fr) minmax(260px, 1.7fr) 92px",
        gap: 10,
        alignItems: "start",
        padding: "10px 11px",
        border: 0,
        borderBottom: "1px solid var(--rl-border)",
        background: "transparent",
        color: "inherit",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          justifyContent: "center",
          padding: "4px 6px",
          borderRadius: 5,
          background: `color-mix(in srgb, ${tone} 13%, transparent)`,
          color: tone,
          font: "700 8.5px/1 var(--rl-mono)",
          letterSpacing: ".045em",
          textTransform: "uppercase",
        }}
      >
        {findingLabel(finding.kind)}
      </span>

      <span style={{ minWidth: 0 }}>
        <strong
          style={{
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            font: "650 11px/1.3 var(--rl-mono)",
          }}
        >
          &lt;{finding.name} /&gt;
        </strong>
        <span style={{ ...muted, display: "block", marginTop: 4 }}>
          {formatMs(finding.selfMs)} self
          {finding.downstream > 0 ? ` · ${finding.downstream} downstream` : ""}
        </span>
      </span>

      <span style={{ minWidth: 0 }}>
        <strong style={{ display: "block", fontSize: 10.8, lineHeight: 1.35 }}>
          {finding.headline}
        </strong>
        <span style={{ ...muted, display: "block", marginTop: 4, lineHeight: 1.45 }}>
          {finding.evidence.filter(Boolean).slice(0, 2).join(" · ")}
        </span>
        {finding.action && (
          <span
            style={{
              display: "block",
              marginTop: 5,
              color: "var(--rl-text)",
              fontSize: 9.5,
              lineHeight: 1.4,
            }}
          >
            <b style={{ color: tone }}>Next:</b> {finding.action}
          </span>
        )}
      </span>

      <span style={{ ...muted, textAlign: "right", lineHeight: 1.5 }}>
        inspect →
      </span>
    </button>
  );
}

function findingLabel(kind: FindingKind): string {
  switch (kind) {
    case "waste":
      return "waste";
    case "identity":
      return "identity";
    case "compiler":
      return "compiler";
    case "context":
      return "context";
    case "cascade":
      return "cascade";
    case "effect":
      return "effect";
    case "external-store":
      return "store";
    case "force-update":
      return "forced";
  }
}

function findingTone(kind: FindingKind): string {
  switch (kind) {
    case "waste":
    case "force-update":
      return "var(--rl-severe)";
    case "identity":
    case "compiler":
    case "context":
      return "var(--rl-warn)";
    case "effect":
      return "var(--rl-render)";
    case "external-store":
    case "cascade":
      return "var(--rl-interaction)";
  }
}

function formatMs(value: number): string {
  if (value <= 0) return "0ms";
  if (value < 0.1) return `${value.toFixed(2)}ms`;
  if (value < 10) return `${value.toFixed(1)}ms`;
  return `${Math.round(value)}ms`;
}

const muted = {
  color: "var(--rl-text-dim)",
  fontSize: 9.5,
} satisfies React.CSSProperties;
