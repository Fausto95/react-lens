import { useState } from "react";

/** Live specimen: clicking re-renders it, so it appears in the Timeline + Renders. */
function TraceSpecimen() {
  const [count, setCount] = useState(0);
  return (
    <div className="spec-row">
      <button className="btn" onClick={() => setCount((c) => c + 1)}>
        Render me
      </button>
      <span className="spec-stat">
        renders: <b>{count + 1}</b>
      </span>
      <span className="tag">select me in the tree →</span>
    </div>
  );
}

export function TraceSection() {
  return (
    <section id="trace">
      <div className="sec-kicker">
        <span className="dot" /> TRACE · what happened
      </div>
      <h2>Every render, on a timeline.</h2>
      <p className="sec-lead">
        A normalized event log of commits and interactions — grouped into the things you actually
        did. Click the button, then find <code>TraceSpecimen</code> in the panel: its render shows
        up on the timeline with real self-time.
      </p>
      <div className="card">
        <TraceSpecimen />
        <div className="card-hint">▶ Each click is a commit — watch the timeline on the right.</div>
      </div>
    </section>
  );
}
