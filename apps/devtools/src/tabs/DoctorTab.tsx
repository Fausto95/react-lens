import type { Diagnostic, StaticFinding } from "@react-lens/diagnostics";
import { shortSource } from "@react-lens/ui";
import { IconSparkle } from "@react-lens/icons";
import { EmptyTab } from "./shared.js";

/** Doctor findings as quiet severity strips — impact chip + one-line fix. */
export function DoctorTab({
  runtime,
  staticFindings,
  onFixWithAI,
}: {
  runtime: Diagnostic[];
  staticFindings: StaticFinding[];
  /** Ask the agent about one finding (same affordance as tree/timeline). */
  onFixWithAI?: (finding: { title: string; detail: string }) => void;
}) {
  if (runtime.length === 0 && staticFindings.length === 0) {
    return <EmptyTab>No issues for this component.</EmptyTab>;
  }
  const fixButton = (finding: { title: string; detail: string }) =>
    onFixWithAI && (
      <button
        type="button"
        className="rl-fix-ai"
        title="Investigate and fix with AI"
        aria-label={`Fix with AI: ${finding.title}`}
        onClick={() => onFixWithAI(finding)}
      >
        <IconSparkle size={11} />
      </button>
    );
  return (
    <div className="rl-doctor">
      {runtime.map((d, i) => (
        <div className={`rl-doc-strip rl-sev-${d.severity}`} key={`r${i}`}>
          <span className="rl-doc-sev-pip" title={d.severity} />
          <div className="rl-doc-strip-body">
            <div className="rl-doc-strip-head">
              <span className="rl-doc-title">{d.title}</span>
              <span className="rl-doc-impact">{Math.round(d.impact)}</span>
              {fixButton(d)}
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
              {fixButton(f)}
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
