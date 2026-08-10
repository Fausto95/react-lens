import type { Diagnostic, StaticFinding } from "@react-lens/diagnostics";
import { shortSource } from "@react-lens/ui";
import { EmptyTab } from "./shared.js";

/** Doctor findings as quiet severity strips — impact chip + one-line fix. */
export function DoctorTab({
  runtime,
  staticFindings,
}: {
  runtime: Diagnostic[];
  staticFindings: StaticFinding[];
}) {
  if (runtime.length === 0 && staticFindings.length === 0) {
    return <EmptyTab>No issues for this component.</EmptyTab>;
  }
  return (
    <div className="rl-doctor">
      {runtime.map((d, i) => (
        <div className={`rl-doc-strip rl-sev-${d.severity}`} key={`r${i}`}>
          <span className="rl-doc-sev-pip" title={d.severity} />
          <div className="rl-doc-strip-body">
            <div className="rl-doc-strip-head">
              <span className="rl-doc-title">{d.title}</span>
              <span className="rl-doc-impact">{Math.round(d.impact)}</span>
            </div>
            <div className="rl-doc-detail">{d.detail}</div>
            {d.fix && <div className="rl-doc-fix">{d.fix}</div>}
            {d.source && (
              <div className="rl-doc-loc">
                {shortSource(d.source.file)}:{d.source.line}
              </div>
            )}
          </div>
        </div>
      ))}
      {staticFindings.map((f, i) => (
        <div className={`rl-doc-strip rl-sev-${f.severity}`} key={`s${i}`}>
          <span className="rl-doc-sev-pip" title={f.severity} />
          <div className="rl-doc-strip-body">
            <div className="rl-doc-strip-head">
              <span className="rl-doc-title">{f.title}</span>
              <span className="rl-doc-impact rl-doc-static">static</span>
            </div>
            <div className="rl-doc-detail">{f.detail}</div>
            {f.fix && <div className="rl-doc-fix">{f.fix}</div>}
            {f.source ? (
              <div className="rl-doc-loc">
                {shortSource(f.source.file)}:{f.source.line}
              </div>
            ) : (
              f.line != null && <div className="rl-doc-loc">L{f.line}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
