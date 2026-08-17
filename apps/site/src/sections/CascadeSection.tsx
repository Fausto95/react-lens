/**
 * Live Cascade story: one interaction fans out into a causal graph the panel
 * already shows on the right. No mock screenshot — the docked Lens is the demo.
 */
export function CascadeSection() {
  return (
    <section id="cascade">
      <div className="sec-kicker">
        <span className="dot" /> CASCADE · render graph
      </div>
      <h2>See the cascade, not just the count.</h2>
      <p className="sec-lead">
        Cascade is the center of the panel: a causal graph for the interaction you just did. Depth
        runs left to right, edges are ordered, repeated leaves aggregate, and Fit / 1:1 / focus
        modes keep a tall fan-out readable. Replay and time travel sit on the same toolbar.
      </p>

      <div className="changelog">
        <article className="change">
          <span className="tag">Graph</span>
          <h3>Cause before cost</h3>
          <p>
            Roots, Expensive, and Cause / Effects focus the subgraph you care about. Hover a node
            for self-time; click to select it in the tree and inspector.
          </p>
        </article>
        <article className="change">
          <span className="tag green">Transport</span>
          <h3>Rewind where you look</h3>
          <p>
            Replay, Replay all, and the travel toggle live next to the graph. Follow <b>Latest</b>{" "}
            as new interactions land, or step ← / → through the rail.
          </p>
        </article>
      </div>
    </section>
  );
}
