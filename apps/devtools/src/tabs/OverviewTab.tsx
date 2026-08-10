import { useState } from "react";
import type { RenderId } from "@react-lens/protocol";
import type { WhyResult } from "@react-lens/causality";
import type { InspectorContext } from "../Inspector.js";
import { DiffLines, EmptyTab } from "./shared.js";

/** Compact Why verdict — one line by default, expand for cause chain. */
export function WhySection({ ctx }: { ctx: InspectorContext }) {
  const { causality, activeRenderId } = ctx;
  const why = activeRenderId !== null ? safeWhy(causality, activeRenderId) : null;
  const [open, setOpen] = useState(false);
  if (!why) return <EmptyTab>No render selected.</EmptyTab>;

  const hasCauses = why.causes.length > 0;

  return (
    <div className={`rl-why rl-why-${why.verdict}`}>
      <button
        type="button"
        className="rl-why-verdict"
        onClick={() => hasCauses && setOpen((o) => !o)}
        aria-expanded={hasCauses ? open : undefined}
      >
        <span className="rl-why-pip" />
        <span className="rl-why-text">{verdictText(why)}</span>
        {hasCauses && <span className="rl-why-chev">{open ? "▾" : "▸"}</span>}
      </button>
      {open &&
        why.causes.map((cause, i) => (
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
      return "No observable DOM change — potentially avoidable";
    case "expected":
      return "Changed observable output";
    case "unknown":
      return "DOM change unknown (no snapshot)";
  }
}

function safeWhy(causality: InspectorContext["causality"], renderId: RenderId): WhyResult | null {
  try {
    return causality.why(renderId);
  } catch {
    return null;
  }
}
