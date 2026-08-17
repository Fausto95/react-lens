import { useEffect, useRef, type RefObject } from "react";
import type { Diagnostic } from "@reactlens/diagnostics";
import type { ComponentId } from "@reactlens/protocol";
import type { TraceStore } from "@reactlens/trace-engine";

const RULE_KIND: Record<string, string> = {
  "render-fanout": "waste",
  "unstable-callback": "identity",
  "wasted-render": "waste",
  "identity-churn": "identity",
  "compiler-bailout": "compiler",
  "context-fanout": "context",
  "parent-cascade": "cascade",
  "external-store": "store",
  "force-update": "forced",
  "effect-heavy": "effect",
};

/**
 * Popover listing Doctor findings by impact. Clicking a row selects that
 * component so the inspector Doctor section can show the full strip.
 */
export function DoctorIssuesMenu({
  diagnostics,
  issueCount,
  store,
  anchorRef,
  onSelect,
  onClose,
}: {
  diagnostics: Diagnostic[];
  /** Full count (may exceed the listed top-N). */
  issueCount: number;
  store: TraceStore;
  /** Toolbar control that owns this menu — clicks here toggle, not dismiss. */
  anchorRef: RefObject<HTMLElement | null>;
  onSelect: (id: ComponentId) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (rootRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [anchorRef, onClose]);

  return (
    <div ref={rootRef} className="rl-menu rl-doctor-menu" role="dialog" aria-label="Doctor issues">
      <div className="rl-menu-head">
        Doctor · {issueCount} issue{issueCount === 1 ? "" : "s"}
      </div>
      {diagnostics.length === 0 ? (
        <div className="rl-doctor-menu-empty">No issues yet — keep recording.</div>
      ) : (
        <div className="rl-doctor-menu-list">
          {diagnostics.map((d) => {
            const name = store.instance(d.componentId)?.name ?? `#${d.componentId}`;
            return (
              <button
                key={`${d.componentId}:${d.ruleId}`}
                type="button"
                className={`rl-doctor-issue rl-sev-${d.severity}`}
                onClick={() => onSelect(d.componentId)}
              >
                <span className="rl-doc-sev-pip" title={d.severity} />
                <span className="rl-doctor-issue-body">
                  <span className="rl-doctor-issue-head">
                    <span className="rl-doctor-issue-kind">{RULE_KIND[d.ruleId] ?? d.ruleId}</span>
                    <span className="rl-doctor-issue-title">{d.title}</span>
                  </span>
                  <span className="rl-doctor-issue-comp">{name}</span>
                  <span className="rl-doctor-issue-detail">{d.detail}</span>
                  {d.fix && (
                    <span className="rl-doctor-issue-next">
                      <b>Next:</b> {d.fix}
                    </span>
                  )}
                </span>
                <span className="rl-doctor-issue-impact">{Math.round(d.impact)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
