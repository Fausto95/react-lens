import type { ComponentInstance, RenderId } from "@react-lens/protocol";
import type { WhyResult } from "@react-lens/causality";
import type { InspectorContext } from "../Inspector.js";
import { ms } from "../format.js";
import { DiffLines } from "./shared.js";

export function OverviewTab({
  ctx,
  inst,
}: {
  ctx: InspectorContext;
  inst: ComponentInstance;
}) {
  const { store, causality, componentId, activeRenderId } = ctx;
  const why = activeRenderId !== null ? safeWhy(causality, activeRenderId) : null;

  return (
    <div>
      <div className="rl-stat-grid">
        <Stat k="Renders" v={String(store.renderCount(componentId))} />
        <Stat k="Self time" v={ms(store.selfTimeTotal(componentId))} />
        <Stat
          k="Compiler"
          v={inst.compiler.compiled ? "compiled" : "not compiled"}
          small
        />
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
    </div>
  );
}

function Stat({ k, v, small }: { k: string; v: string; small?: boolean }) {
  return (
    <div className="rl-stat">
      <div className="rl-k">{k}</div>
      <div className="rl-v" style={small ? { fontSize: 13 } : undefined}>
        {v}
      </div>
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

function safeWhy(causality: InspectorContext["causality"], renderId: RenderId): WhyResult | null {
  try {
    return causality.why(renderId);
  } catch {
    return null;
  }
}
