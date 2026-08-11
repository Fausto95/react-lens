import { useState } from "react";

const PANELS = ["Alpha", "Beta", "Gamma"];

/**
 * One independent piece of state per panel — bump a single one between the
 * marks and the A→B index names exactly that panel, not the whole subtree.
 */
function Panel({ label }: { label: string }) {
  const [n, setN] = useState(0);
  return (
    <button className="btn" onClick={() => setN((v) => v + 1)}>
      {label}: {n}
    </button>
  );
}

function ComparePanels() {
  return (
    <div className="spec-row">
      {PANELS.map((p) => (
        <Panel key={p} label={p} />
      ))}
      <span className="spec-stat">three independent states</span>
    </div>
  );
}

export function CompareSection() {
  return (
    <section id="compare">
      <div className="sec-kicker">
        <span className="dot" /> COMPARE · what changed between two moments
      </div>
      <h2>Mark A. Mark B. Diff the whole app.</h2>
      <p className="sec-lead">
        The inspector’s diff answers “what changed in this render”. A/B answers the bigger question:
        between <em>these two points in time</em>, which components ended up somewhere different?
        React Lens resolves the render each component was showing at A and at B, then lists every
        one where those differ — the same resolution time travel uses, so the index is exactly what
        you’d see if you scrubbed there.
      </p>

      <div className="card">
        <ComparePanels />
        {/* .card-hint is a flex row: keep the prose in one item so inline
            <code> doesn't become a sibling column. */}
        <div className="card-hint">
          <span>
            ▶ <kbd>Double-click</kbd> a commit tick in the timeline’s <code>CMT</code> lane — A
            lands just before it, B just after, and the index opens showing what that one commit
            changed.
          </span>
        </div>
      </div>

      {/* Same flex rule as .card-hint: the counter is item one, the prose item two. */}
      <div className="steps">
        <div className="step">
          <span>
            Set the marks. <kbd>Alt</kbd> + click the timeline sets <b>A</b>, <kbd>Shift</kbd> +
            click sets <b>B</b> — on empty track or straight on a commit bar. Keep the shift-click
            still: dragging it becomes a zoom rubber band instead.
          </span>
        </div>
        <div className="step">
          <span>
            Read the pill. The timeline header grows <code>A→B · N changed</code>; click it for the
            whole-app index, ✕ next to it clears both marks. The shaded band between the marks shows
            the range you’re comparing.
          </span>
        </div>
        <div className="step">
          <span>
            Click a row. The component is selected and the inspector grows a <b>Compare A ↔ B</b>{" "}
            section with the value-level props and state diff — before → after, across the whole
            span rather than one render.
          </span>
        </div>
      </div>

      <div className="changelog">
        <article className="change">
          <span className="tag">changed</span>
          <h3>Different render at A than at B</h3>
          <p>
            Rows are sorted by how much the component churned inside the range, with its render
            count and self-time. Everything else is folded into the <code>unchanged</code> tally in
            the header — an 882-component tree where you bumped one panel reads as{" "}
            <code>1 changed · 881 unchanged</code>, which is the whole point.
          </p>
        </article>
        <article className="change">
          <span className="tag orange">new · gone</span>
          <h3>When one side has nothing</h3>
          <p>
            <code>new</code> means the component had no retained render at A — it first appears
            inside the range. <code>gone</code> means its history at B was evicted by the ring
            buffer. Both are still listed, because “it wasn’t there yet” is an answer too.
          </p>
        </article>
      </div>
    </section>
  );
}
