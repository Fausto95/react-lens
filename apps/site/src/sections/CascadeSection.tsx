/**
 * Live Cascade story: one interaction, read two ways in the panel docked to the
 * right. No mock screenshot — the docked Lens is the demo.
 */
export function CascadeSection() {
  return (
    <section id="cascade">
      <div className="sec-kicker">
        <span className="dot" /> CASCADE · two lenses
      </div>
      <h2>See the cascade, not just the count.</h2>
      <p className="sec-lead">
        Cascade is the center of the panel: everything that rendered because of the interaction you
        just did, and why. One projection, two readings — a ledger you read top to bottom, and a
        roll-up that ranks components by what they cost. Replay and time travel sit on the same
        toolbar.
      </p>

      <div className="changelog">
        <article className="change">
          <span className="tag">Ledger</span>
          <h3>Cause before cost</h3>
          <p>
            Depth becomes indentation, so hundreds of renders stay in reading order. Library
            wrappers and pass-through chains fold away; each row carries its own self time and its
            subtree&apos;s. A props render names the keys that changed and, when they came from a
            component other than the parent above it, the <b>owner</b> that sent them — React&apos;s
            second tree, drawn on the first. Filter by name and the ancestors of every hit are kept,
            or press <b>Δ</b> to keep only what changed since the last time the same component
            started an interaction.
          </p>
        </article>
        <article className="change">
          <span className="tag">Roll-up</span>
          <h3>What to fix</h3>
          <p>
            One row per component: how many times it rendered, why, what it cost, and a verdict —
            <b> hot</b> for the render that dominates, <b>passenger</b> for the one that re-renders
            for free. Click a row to drill into that component.
          </p>
        </article>
        <article className="change">
          <span className="tag green">Transport</span>
          <h3>Rewind where you look</h3>
          <p>
            Replay, Replay all, and the travel toggle live next to the lens switch. Follow{" "}
            <b>Latest</b> as new interactions land, or step ← / → through the rail.
          </p>
        </article>
      </div>
    </section>
  );
}
