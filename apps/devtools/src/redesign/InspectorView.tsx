import { useState, type ReactNode } from "react";
import type { ComponentId, RenderId } from "@reactlens/protocol";
import type { TraceStore } from "@reactlens/trace-engine";
import type { LaneKey } from "../laneFilter.js";
import type { RenderStory, TriggeredEntry } from "../inspector/renderStory.js";
import { ChangeDiffRows } from "../tabs/RendersTab.js";

/**
 * The concept's inspector column: one scrollable column of numbered sections —
 * Cause → Change → Cost → Fix — under an owner-chain breadcrumb. No tabs.
 */
export function InspectorView({
  store,
  componentId,
  story,
  t0,
  t1,
  fixApplied,
  onToggleFix,
  onSelectComponent,
  onHoverComponent,
  onSelectRender,
  headAction,
}: {
  store: TraceStore;
  componentId: ComponentId | null;
  story: RenderStory | null;
  t0: number | null;
  t1: number | null;
  fixApplied: boolean;
  onToggleFix: () => void;
  onSelectComponent?: (id: ComponentId) => void;
  onHoverComponent?: (id: ComponentId | null) => void;
  /** Jump the timeline selection to a render this clip triggered. */
  onSelectRender?: (renderId: RenderId, laneKey: LaneKey) => void;
  /** Trailing control in the column heading — the shell's collapse toggle. */
  headAction?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const name = componentId === null ? null : (store.instance(componentId)?.name ?? null);

  if (componentId === null) {
    return (
      <>
        <div className="colhead">
          Inspector
          {headAction}
        </div>
        <div className="isect why">
          Select a component in the tree, or a render clip on the timeline.
        </div>
      </>
    );
  }

  // The selected component's name is the inspector's anchor — it must be
  // present whenever something is selected, even before a clip is picked.
  const header = (
    <div className="rl-insp-head">
      <h2>{name}</h2>
    </div>
  );

  if (!story) {
    return (
      <>
        <div className="colhead">
          Inspector
          {headAction}
        </div>
        {header}
        <div className="crumb">
          {ownerChain(store, componentId).map((step, i, all) => (
            <span key={step.id}>
              {i > 0 && " › "}
              {i === all.length - 1 ? <b>{step.name}</b> : step.name}
            </span>
          ))}
        </div>
        <div className="isect why">
          Select a render clip on the timeline to see why this rendered.
        </div>
      </>
    );
  }

  // Sub-ms renders often measure as 0 — still paint a concept-shaped meter
  // (full render slice) so Cost doesn't look broken next to the HTML mock.
  const measured = story.cost.render + story.cost.subtree + story.cost.effects;
  const phases = measured > 0 ? story.cost : { render: 0.1, subtree: 0, effects: 0 };
  const total = phases.render + phases.subtree + phases.effects || 1;
  const pct = (v: number) => Math.round((v / total) * 100);

  return (
    <>
      <div className="colhead">
        Inspector
        {t0 !== null && t1 !== null && (
          <span className="right">
            t = {Math.round(t0).toLocaleString("en-US")}–{Math.round(t1).toLocaleString("en-US")} ms
          </span>
        )}
        {headAction}
      </div>

      {header}

      <div className="crumb" onMouseLeave={() => onHoverComponent?.(null)}>
        {ownerChain(store, componentId).map((step, i, all) => (
          <span key={step.id}>
            {i > 0 && " › "}
            {i === all.length - 1 ? (
              <b>{step.name}</b>
            ) : (
              <span
                role="button"
                tabIndex={0}
                onClick={() => onSelectComponent?.(step.id)}
                onMouseEnter={() => onHoverComponent?.(step.id)}
                onKeyDown={(e) => e.key === "Enter" && onSelectComponent?.(step.id)}
              >
                {step.name}
              </span>
            )}
          </span>
        ))}
      </div>

      <div className="isect">
        <div className="ihead">
          <span className="n">1</span>Cause
        </div>
        <div className="why">{story.headline}</div>
        {story.chain.length > 0 && (
          <div className="chain">
            {story.chain.map((step, i) => (
              <div key={i}>
                {i > 0 && <div className="pipe" />}
                <div
                  className={`step${step.kind === "origin" ? " src" : step.kind === "target" ? " dst" : ""}`}
                  {...(step.componentId !== undefined
                    ? {
                        role: "button",
                        tabIndex: 0,
                        onClick: () => onSelectComponent?.(step.componentId!),
                      }
                    : {})}
                >
                  {step.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="isect">
        <div className="ihead">
          <span className="n">2</span>Change
        </div>
        <ChangeDiffRows changes={story.changes} refWarning={story.refWarning} />
      </div>

      <div className="isect">
        <div className="ihead">
          <span className="n">3</span>Cost
        </div>
        <div className="phases">
          <i style={{ width: `${pct(phases.render)}%`, background: "rgba(76,141,255,.6)" }} />
          <i style={{ width: `${pct(phases.subtree)}%`, background: "rgba(62,207,142,.55)" }} />
          <i style={{ width: `${pct(phases.effects)}%`, background: "rgba(167,139,250,.55)" }} />
        </div>
        <div className="plegend">
          <span>
            render <em>{formatPhaseMs(story.cost.render, measured === 0)} ms</em>
          </span>
          <span>
            subtree <em>{formatPhaseMs(story.cost.subtree)} ms</em>
          </span>
          <span>
            effects <em>{formatPhaseMs(story.cost.effects)} ms</em>
          </span>
        </div>
      </div>

      <div className="isect">
        <div className="ihead">
          <span className="n">4</span>Fix
        </div>
        <div className="fix">{story.fix.text}</div>
        {story.fix.code && (
          <div className="code">
            <span
              className="copy"
              role="button"
              tabIndex={0}
              onClick={() => {
                void navigator.clipboard?.writeText(story.fix.code!);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </span>
            {highlightFixCode(story.fix.code)}
          </div>
        )}
        {story.fix.replayable && (
          <div
            className={`apply${fixApplied ? " undone" : ""}`}
            role="button"
            tabIndex={0}
            onClick={onToggleFix}
            onKeyDown={(e) => e.key === "Enter" && onToggleFix()}
          >
            {fixApplied ? "Reset replay" : "Replay with fix →"}
          </div>
        )}
      </div>

      <div className="isect" style={{ borderBottom: "none" }}>
        <div className="ihead">
          <span className="n">5</span>Triggered
        </div>
        <TriggeredList triggered={story.triggered} onSelectRender={onSelectRender} />
      </div>
    </>
  );
}

/**
 * Renders this clip directly triggered. Module-level on purpose — an inline
 * component definition remounts on every ingest and drops in-flight clicks
 * (see the note in tabs/RelationsTab).
 */
function TriggeredList({
  triggered,
  onSelectRender,
}: {
  triggered: RenderStory["triggered"];
  onSelectRender?: (renderId: RenderId, laneKey: LaneKey) => void;
}) {
  if (triggered.entries.length === 0) {
    return <div className="why">No downstream renders.</div>;
  }
  const pick = (e: TriggeredEntry) => onSelectRender?.(e.renderId, e.laneKey);
  const overflow = triggered.triggeredTotal - triggered.entries.length;
  return (
    <>
      <div className="diff trig">
        {triggered.entries.map((e) => (
          <div
            key={e.renderId}
            className="row add trow"
            role="button"
            tabIndex={0}
            onClick={() => pick(e)}
            onKeyDown={(ev) => ev.key === "Enter" && pick(e)}
          >
            <span className="tname">+ {e.name}</span>
            <span className="tcause">{e.cause}</span>
            <span className="tms">{formatPhaseMs(e.selfMs)} ms</span>
          </div>
        ))}
      </div>
      <div className="tfoot">
        {overflow > 0 && <span>+{overflow} more · </span>}
        <span>cascade: {triggered.cascadeTotal} downstream</span>
      </div>
    </>
  );
}

/** Owner chain root-first, capped so a 14-deep tree doesn't wrap forever. */
function ownerChain(store: TraceStore, id: ComponentId): Array<{ id: ComponentId; name: string }> {
  const chain: Array<{ id: ComponentId; name: string }> = [];
  const seen = new Set<ComponentId>();
  let cur: ComponentId | undefined = id;
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur);
    const inst = store.instance(cur);
    if (!inst) break;
    chain.unshift({ id: cur, name: inst.name });
    cur = inst.parentId;
  }
  return chain.length > 5 ? chain.slice(-5) : chain;
}

function formatPhaseMs(n: number, belowFloor = false): string {
  if (belowFloor) return "<0.1";
  if (n <= 0) return "0";
  if (n < 0.1) return n.toFixed(2);
  if (n < 10) return n.toFixed(1);
  return String(Math.round(n));
}

/**
 * Concept HTML paints keywords (`.k`), calls (`.f`), and string/comment spans
 * (`.s`). Keep `fix.code` plain for Copy; wrap tokens here for display.
 */
function highlightFixCode(code: string): ReactNode[] {
  const re =
    /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(\b(?:const|let|var|return|export|default|function)\b)|(\b(?:useCallback|useMemo|useContextSelector|memo|useState|useEffect)\b)|('[^']*'|"[^"]*"|`[^`]*`)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const [full, comment, kw, fn, str] = m;
    const cls = comment || str ? "s" : kw ? "k" : fn ? "f" : undefined;
    out.push(
      cls ? (
        <span key={key++} className={cls}>
          {full}
        </span>
      ) : (
        full
      ),
    );
    last = m.index + full.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}
