import type { RenderId } from "@react-lens/protocol";
import type { WhyResult } from "@react-lens/causality";
import type { InspectorContext } from "../Inspector.js";
import { DiffLines, EmptyTab } from "./shared.js";

/** The causal explanation for the active render — the inspector's headline. */
export function WhySection({ ctx }: { ctx: InspectorContext }) {
  const { causality, activeRenderId } = ctx;
  const why = activeRenderId !== null ? safeWhy(causality, activeRenderId) : null;
  if (!why) return <EmptyTab>No render selected.</EmptyTab>;

  return (
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
