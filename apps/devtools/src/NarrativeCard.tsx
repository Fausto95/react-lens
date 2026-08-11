import type { Narrative, LensRef, NarrativeNextClick } from "@reactlens/explain";
import type { ComponentId, RenderId } from "@reactlens/protocol";
import { ms } from "@reactlens/ui";

export function NarrativeCard({
  narrative,
  onCitation,
  onNext,
  onClose,
}: {
  narrative: Narrative;
  onCitation: (ref: LensRef) => void;
  onNext: (next: NarrativeNextClick) => void;
  onClose: () => void;
}) {
  return (
    <div className="rl-narrative" role="region" aria-label="Explain this interaction">
      <div className="rl-narrative-head">
        <div className="rl-narrative-titles">
          <div className="rl-narrative-kicker">Explain</div>
          <div className="rl-narrative-headline">{narrative.headline}</div>
          <p className="rl-narrative-summary">{narrative.summary}</p>
        </div>
        <button
          type="button"
          className="rl-icon-btn"
          onClick={onClose}
          title="Close explain"
          aria-label="Close explain"
        >
          ×
        </button>
      </div>

      <div className="rl-narrative-grid">
        <section className="rl-narrative-sec">
          <h4>Cost</h4>
          {narrative.topCost.length === 0 ? (
            <div className="rl-narrative-empty">No renders</div>
          ) : (
            <ul>
              {narrative.topCost.map((row) => (
                <li key={`${row.renderId}`}>
                  <button
                    type="button"
                    className="rl-narrative-link"
                    onClick={() =>
                      onCitation({
                        kind: "component",
                        id: row.componentId,
                        label: row.name,
                      })
                    }
                  >
                    <span className="rl-narrative-name">
                      {row.name}
                      {row.wasted ? " · waste" : ""}
                    </span>
                    <span className="rl-narrative-ms">{ms(row.self)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rl-narrative-sec">
          <h4>Cause chain</h4>
          {narrative.chain.length === 0 ? (
            <div className="rl-narrative-empty">No cause data</div>
          ) : (
            <ol>
              {narrative.chain.map((c, i) => (
                <li key={i}>
                  <span className="rl-narrative-level">L{c.level}</span> {c.explanation}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rl-narrative-sec">
          <h4>Doctor</h4>
          {narrative.doctor.length === 0 ? (
            <div className="rl-narrative-empty">No findings on top cost</div>
          ) : (
            <ul>
              {narrative.doctor.map((d) => (
                <li key={`${d.ruleId}-${d.componentId}`}>
                  <button
                    type="button"
                    className="rl-narrative-link"
                    onClick={() =>
                      onCitation({
                        kind: "doctor",
                        ruleId: d.ruleId,
                        componentId: d.componentId,
                        label: d.title,
                      })
                    }
                  >
                    <span className="rl-narrative-name">{d.title}</span>
                    <span className="rl-narrative-ms">{Math.round(d.impact)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {narrative.nextClick && (
        <div className="rl-narrative-next">
          <button
            type="button"
            className="rl-btn primary"
            onClick={() => onNext(narrative.nextClick!)}
          >
            Next: {narrative.nextClick.reason}
          </button>
        </div>
      )}

      <div className="rl-narrative-cites" aria-label="Citations">
        {narrative.citations.slice(0, 10).map((ref, i) => (
          <button
            key={i}
            type="button"
            className="rl-narrative-chip"
            onClick={() => onCitation(ref)}
            title={citeTitle(ref)}
          >
            {citeLabel(ref)}
          </button>
        ))}
      </div>
    </div>
  );
}

function citeLabel(ref: LensRef): string {
  switch (ref.kind) {
    case "interaction":
      return ref.label;
    case "component":
      return ref.label;
    case "render":
      return `r${ref.id}`;
    case "doctor":
      return ref.label;
  }
}

function citeTitle(ref: LensRef): string {
  switch (ref.kind) {
    case "interaction":
      return `Interaction ${ref.id}`;
    case "component":
      return `Component #${ref.id}`;
    case "render":
      return `Render #${ref.id}`;
    case "doctor":
      return `${ref.ruleId} on #${ref.componentId}`;
  }
}

export type { ComponentId, RenderId };
