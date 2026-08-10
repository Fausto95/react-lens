import { useMemo } from "react";
import type { InspectorContext } from "../Inspector.js";
import { diagnoseOne } from "../doctor.js";
import { EmptyTab } from "./shared.js";

/** Doctor diagnostics for the selected component, ranked by impact. */
export function DoctorTab({ ctx }: { ctx: InspectorContext }) {
  const { store, causality, componentId } = ctx;
  const diagnostics = useMemo(
    () => diagnoseOne(store, causality, componentId),
    [store, causality, componentId],
  );

  if (diagnostics.length === 0) return <EmptyTab>No issues detected for this component.</EmptyTab>;

  return (
    <div className="rl-doctor">
      {diagnostics.map((d, i) => (
        <div className={`rl-doc rl-sev-${d.severity}`} key={i}>
          <div className="rl-doc-head">
            <span className="rl-doc-mark">⚕</span>
            <span className="rl-doc-title">{d.title}</span>
            <span className="rl-doc-impact">{Math.round(d.impact)}</span>
          </div>
          <div className="rl-doc-detail">{d.detail}</div>
          {d.fix && <div className="rl-doc-fix">→ {d.fix}</div>}
        </div>
      ))}
    </div>
  );
}
