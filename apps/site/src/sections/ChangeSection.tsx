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
      <span className="spec-stat">
        count=<b>{state.count}</b> · label=<b>{state.label}</b>
      </span>
    </div>
  );
}

export function ChangeSection() {
  return (
    <section id="diff">
      <div className="sec-kicker">
        <span className="dot" /> DIFF · what changed
      </div>
      <h2>Bisect the commit that broke perf.</h2>
      <p className="sec-lead">
        One universal diff over values, props, state, and DOM — then A/B any two Lens commits for a
        whole-app index of what ended up different. Simulate the fix with live edit or Replay with
        fix before you ship the change.
      </p>

      <div className="card">
        <DiffSpecimen />
        {/* .card-hint is a flex row: keep the prose in one item so inline
            <code> doesn't become a sibling column. */}
        <div className="card-hint">
          <span>
            ▶ Edit <code>count</code> in the inspector — the page reacts.
          </span>
        </div>
      </div>

      <div className="changelog">
        <article className="change">
          <span className="tag">Per render</span>
          <h3>What this commit did</h3>
          <p>
            Value and DOM diffs for the selected render, so “it re-rendered” and “it changed” stop
            being the same claim.
          </p>
        </article>
        <article className="change">
          <span className="tag orange">A → B</span>
          <h3>What two moments apart did</h3>
          <p>
            Mark <b>A</b> and <b>B</b> on the timeline (<kbd>[</kbd> / <kbd>]</kbd>) — a whole-app
            index that reads <code>1 changed · 881 unchanged</code>. Same idea in CI: named
            interactions and <code>react-lens ci</code> bisect which Lens commit broke perf.
          </p>
        </article>
      </div>
    </section>
  );
}
