import { useReducer, useState } from "react";

/**
 * Live specimen for real time travel. The left half is React state (rewinds);
 * the uncontrolled input is deliberate — it demonstrates the documented limit
 * that DOM-only state stays put when the playhead moves.
 */
function TimeMachineSpecimen() {
  const [count, setCount] = useState(0);
  const [cart, dispatch] = useReducer(
    (items: string[], action: { type: "add" } | { type: "clear" }) =>
      action.type === "add" ? [...items, `item ${items.length + 1}`] : [],
    [],
  );
  return (
    <div className="spec-row">
      <button className="btn" onClick={() => setCount((c) => c + 1)}>
        count: {count}
      </button>
      <button className="btn" onClick={() => dispatch({ type: "add" })}>
        cart: {cart.length}
      </button>
      <input className="spec-input" placeholder="uncontrolled — won't rewind" />
      <span className="tag">state rewinds · this input doesn't</span>
    </div>
  );
}

export function TimeTravelSection() {
  return (
    <section id="time-travel">
      <div className="sec-kicker">
        <span className="dot" /> TIME TRAVEL · when it happened
      </div>
      <h2>Scrub the playhead. The page follows.</h2>
      <p className="sec-lead">
        Not a highlight animation — the page's actual state moves with the timeline, like Redux
        DevTools for any React app. The page runtime keeps the <em>raw</em> state each component had
        at every commit; the panel works out which render each component was showing at time{" "}
        <code>t</code> and the page restores exactly those values through React's own dev-build
        override API. Nothing is serialized, nothing is replayed — state is put back, and React
        re-renders from it.
      </p>

      <div className="card">
        <TimeMachineSpecimen />
        <div className="card-hint">
          ▶ Click the buttons a few times, then drag the timeline playhead left (or press ←). Watch
          the numbers rewind on this page. Press L to snap back to now.
        </div>
      </div>

      <div className="steps">
        <div className="step">
          Interact — clicks land as commits on the timeline. The rewind toggle (↺, next to the zoom
          controls) is on by default in dev builds.
        </div>
        <div className="step">
          Drag the playhead into the past. It turns purple while it drives the page; only components
          whose target render changed are re-applied, so scrubbing stays smooth.
        </div>
        <div className="step">
          Recording pauses while you're in the past — no feedback loop, the timeline stays frozen.
          Go live (L) and the pre-scrub state is restored from a saved baseline; recording resumes.
        </div>
      </div>

      <div className="changelog">
        <article className="change">
          <span className="tag green">Rewinds</span>
          <h3>What travels</h3>
          <p>
            <code>useState</code>, <code>useReducer</code>, and class component state — and
            everything derived from them during render: computed values, class names, inline styles,
            context whose value comes from a rewound provider's state. Space-play replays the whole
            session's state evolution on the page.
          </p>
        </article>
        <article className="change">
          <span className="tag orange">Stays put</span>
          <h3>What doesn't</h3>
          <p>
            Refs, external stores (<code>useSyncExternalStore</code>, Redux, Zustand), module state,
            uncontrolled inputs (try the one above), server state, and imperative DOM mutations made
            outside React. Effects re-run against rewound values — same rules as Redux DevTools.
            Components mounted after the cursor stay mounted (the tree dims them), and production
            React builds have no override API, so the toggle is disabled there.
          </p>
        </article>
      </div>
    </section>
  );
}
