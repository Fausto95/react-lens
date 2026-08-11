import { useState } from "react";

/**
 * Live specimen for reveal-on-select. Named so it's easy to find by name in the
 * tree or ⌘K from anywhere on the page — which is the whole demo: pick it from
 * a screen away and the page walks back here.
 */
function RevealSpecimen() {
  const [hits, setHits] = useState(0);
  return (
    <div className="spec-row">
      <button className="btn" onClick={() => setHits((h) => h + 1)}>
        I'm the target
      </button>
      <span className="spec-stat">
        clicks: <b>{hits}</b>
      </span>
      <span className="tag green">find me from anywhere</span>
    </div>
  );
}

export function RevealSection() {
  return (
    <section id="reveal">
      <div className="sec-kicker">
        <span className="dot" /> SELECT · where it lives
      </div>
      <h2>Pick a component. The page comes to it.</h2>
      <p className="sec-lead">
        Selection runs both ways. With the crosshair armed, clicking an element on the page selects
        it in the tree; selecting anything in the panel scrolls <em>this page</em> to it and
        outlines it — so a component you found in a 900-node tree, a ⌘K search, or an A→B index is
        never a component you then have to go hunting for by hand.
      </p>

      <div className="card">
        <RevealSpecimen />
        <div className="card-hint">
          <span>
            ▶ Scroll a few screens away, then press <kbd>⌘K</kbd> and type{" "}
            <code>RevealSpecimen</code>. The page walks back here and the outline lands on the row
            above.
          </span>
        </div>
      </div>

      <div className="steps">
        <div className="step">
          <span>
            Every pick goes through one path — tree row, <kbd>⌘K</kbd>, a timeline bar, a relations
            link, the waste banner, the crosshair picker (<kbd>⌘\</kbd>). The page and the inspector
            can't disagree about what's selected.
          </span>
        </div>
        <div className="step">
          <span>
            Off-screen components are scrolled into view; ones already on screen are left exactly
            where they are. That's what makes walking the tree with <kbd>↑</kbd>/<kbd>↓</kbd> usable
            — the page only moves when it has something new to show you.
          </span>
        </div>
        <div className="step">
          <span>
            The outline is stuck to the component, not to the viewport: it tracks scrolling and
            resizing for as long as it's visible, including during its own reveal.
          </span>
        </div>
      </div>

      <div className="changelog">
        <article className="change">
          <span className="tag">Hover vs. select</span>
          <h3>Only selection moves the page</h3>
          <p>
            Hovering a tree row outlines the component and nothing else — a mousemove-rate event has
            no business scrolling anything. Reveal is reserved for a deliberate pick, and it honours{" "}
            <code>prefers-reduced-motion</code> by jumping instead of animating.
          </p>
        </article>
        <article className="change">
          <span className="tag orange">Your call</span>
          <h3>Turn it off in one click</h3>
          <p>
            <b>Scroll to selection</b> lives in the panel's settings popover (the sliders icon, next
            to the record button) and is on by default. Switch it off and selection goes back to
            outline-only; the choice is remembered across sessions.
          </p>
        </article>
      </div>
    </section>
  );
}
