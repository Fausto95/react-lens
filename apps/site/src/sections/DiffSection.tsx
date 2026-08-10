import { useState } from "react";

/**
 * Live specimen with editable state: bump it here, or edit `count`/`label`
 * directly from the inspector (live edit via the dev renderer) and watch the
 * page update. The inspector's diff shows exactly what changed between renders.
 */
function DiffSpecimen() {
  const [state, setState] = useState({ count: 1, label: "hello" });
  return (
    <div className="spec-row">
      <button className="btn" onClick={() => setState((s) => ({ ...s, count: s.count + 1 }))}>
        count + 1
      </button>
      <button
        className="btn"
        onClick={() => setState((s) => ({ ...s, label: s.label === "hello" ? "world" : "hello" }))}
      >
        toggle label
      </button>
      <span className="spec-stat">count=<b>{state.count}</b> · label=<b>{state.label}</b></span>
    </div>
  );
}

export function DiffSection() {
  return (
    <section id="diff">
      <div className="sec-kicker"><span className="dot" /> DIFF · what changed</div>
      <h2>See the change, not the whole object.</h2>
      <p className="sec-lead">
        One universal diff over values, props, state, and DOM. Select
        <code> DiffSpecimen</code>, bump it, and the inspector shows the precise
        before → after — reference-only churn flagged separately from real changes.
        You can even edit the value from the panel and it reflects here.
      </p>
      <div className="card">
        <DiffSpecimen />
        <div className="card-hint">▶ Edit <code>count</code> in the inspector — the page reacts.</div>
      </div>
    </section>
  );
}
