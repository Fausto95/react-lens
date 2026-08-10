import { useState, useEffect } from "react";
import type { TraceStore } from "@react-lens/trace-engine";
import type { Causality, WhyResult } from "@react-lens/causality";
import type { ComponentId, RenderId } from "@react-lens/protocol";
import { diff, type DiffResult } from "@react-lens/diff-engine";
import { useTraceVersion } from "./useLens.js";
import { formatValue, ms } from "./format.js";

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
  const [selectedRender, setSelectedRender] = useState<RenderId | null>(null);

  // Default to the latest render whenever new ones arrive.
  const latest = renders.at(-1);
  useEffect(() => {
    if (latest) setSelectedRender(latest.renderId);
  }, [latest?.renderId]);

  if (!inst) return <div className="rl-empty">Component no longer mounted.</div>;

  const activeRenderId = selectedRender ?? latest?.renderId ?? null;
  const why: WhyResult | null =
    activeRenderId !== null ? safeWhy(causality, activeRenderId) : null;

  const propsDiff = activeRenderId !== null ? propsDiffFor(store, componentId, activeRenderId) : null;

  return (
    <div className="rl-inspector">
      <h2>{inst.name}</h2>
      <div className="rl-source">
        {inst.source ? `${inst.source.file}:${inst.source.line}` : "source unavailable"}
      </div>

      <div className="rl-stat-grid">
        <div className="rl-stat">
          <div className="rl-k">Renders</div>
          <div className="rl-v">{store.renderCount(componentId)}</div>
        </div>
        <div className="rl-stat">
          <div className="rl-k">Self time</div>
          <div className="rl-v">{ms(store.selfTimeTotal(componentId))}</div>
        </div>
        <div className="rl-stat">
          <div className="rl-k">Compiler</div>
          <div className="rl-v" style={{ fontSize: 13 }}>
            {inst.compiler.compiled ? "compiled" : "not compiled"}
          </div>
        </div>
      </div>

      <div className="rl-section-title">Render history</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {renders.map((r) => (
          <button
            key={r.renderId}
            className={`rl-badge ${r.renderId === activeRenderId ? "render" : "dim"}`}
            style={{ cursor: "pointer", border: "none" }}
            onClick={() => setSelectedRender(r.renderId)}
            title={`${ms(r.selfDuration)} · ${r.reasons.map((x) => x.type).join(", ")}`}
          >
            #{String(r.renderId)}
          </button>
        ))}
      </div>

      {why && (
        <>
          <div className="rl-section-title">Why did this render?</div>
          <div className="rl-why">
            <div className={`rl-verdict ${why.verdict}`}>{verdictText(why)}</div>
            {why.causes.map((cause, i) => (
              <div className="rl-cause" key={i}>
                <div className="rl-cause-head">
                  <span className="rl-level">L{cause.level}</span>
                  <span className="rl-conf">{Math.round(cause.confidence * 100)}%</span>
                </div>
                <div className="rl-explain">{cause.explanation}</div>
                {cause.diff && <DiffLines result={cause.diff} />}
              </div>
            ))}
          </div>
        </>
      )}

      {propsDiff && propsDiff.summary.changed > 0 && (
        <>
          <div className="rl-section-title">Props diff (vs previous render)</div>
          <DiffLines result={propsDiff} />
        </>
      )}
    </div>
  );
}

function DiffLines({ result }: { result: DiffResult }) {
  const changes = result.changes.filter((c) => c.kind !== "UNCHANGED" && c.path.length > 0);
  if (changes.length === 0) return <div className="rl-diff">No value changes.</div>;
  return (
    <div className="rl-diff">
      {changes.map((c, i) => (
        <div className={`rl-diff-line rl-chg-${c.kind}`} key={i}>
          <span className="rl-path">{c.path.join(".") || "(root)"}</span>
          <span>
            {formatValue(c.before)} → {formatValue(c.after)}
          </span>
        </div>
      ))}
    </div>
  );
}

function verdictText(why: WhyResult): string {
  switch (why.verdict) {
    case "no-observable-change":
      return "⚠ This render produced no observable DOM change — potentially avoidable.";
    case "expected":
      return "✓ This render changed observable output.";
    case "unknown":
      return "DOM output change unknown (no snapshot captured).";
  }
}

function safeWhy(causality: Causality, renderId: RenderId): WhyResult | null {
  try {
    return causality.why(renderId);
  } catch {
    return null;
  }
}

function propsDiffFor(
  store: TraceStore,
  componentId: ComponentId,
  renderId: RenderId,
): DiffResult | null {
  const history = store.rendersOf(componentId);
  const idx = history.findIndex((r) => r.renderId === renderId);
  if (idx <= 0) return null;
  const prev = store.snapshot(history[idx - 1]!.renderId);
  const cur = store.snapshot(renderId);
  if (!prev || !cur) return null;
  return diff({ kind: "props", before: prev.props, after: cur.props });
}
