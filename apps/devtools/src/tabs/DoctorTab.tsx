import type { Diagnostic, StaticFinding } from "@react-lens/diagnostics";
import { EmptyTab } from "./shared.js";

/** Doctor diagnostics: ranked runtime evidence + static source findings. */
export function DoctorTab({
  runtime,
  staticFindings,
}: {
  runtime: Diagnostic[];
  staticFindings: StaticFinding[];
}) {
  if (runtime.length === 0 && staticFindings.length === 0) {
    return <EmptyTab>No issues detected for this component.</EmptyTab>;
  }
  return (
    <div className="rl-doctor">
      {runtime.map((d, i) => (
        <div className={`rl-doc rl-sev-${d.severity}`} key={`r${i}`}>
          <div className="rl-doc-head">
            <span className="rl-doc-mark">⚕</span>
            <span className="rl-doc-title">{d.title}</span>
            <span className="rl-doc-impact">{Math.round(d.impact)}</span>
          </div>
          <div className="rl-doc-detail">{d.detail}</div>
          {d.fix && <div className="rl-doc-fix">→ {d.fix}</div>}
        </div>
      ))}
      {staticFindings.map((f, i) => (
        <div className={`rl-doc rl-sev-${f.severity}`} key={`s${i}`}>
          <div className="rl-doc-head">
            <span className="rl-doc-mark">⚕</span>
            <span className="rl-doc-title">{f.title}</span>
            <span className="rl-doc-impact rl-doc-static">static{f.line ? ` · L${f.line}` : ""}</span>
          </div>
          <div className="rl-doc-detail">{f.detail}</div>
          {f.fix && <div className="rl-doc-fix">→ {f.fix}</div>}
        </div>
      ))}
    </div>
  );
}
