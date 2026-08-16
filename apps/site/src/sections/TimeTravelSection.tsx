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
        <span className="dot" /> REWIND · any commit
      </div>
      <h2>Time travel through real state.</h2>
      <p className="sec-lead">
        Rewind any render — not a highlight animation. In a development React build, the page keeps
        the raw <code>useState</code> / <code>useReducer</code> / class state each component had at
        every commit and puts it back through React’s own override API.
      </p>

      <div className="card">
        <TimeMachineSpecimen />
        {/* .card-hint is a flex row: keep the prose in one item so inline
            <kbd> doesn't become a sibling column. */}
        <div className="card-hint">
          <span>
            ▶ Click a few times, then use <b>Replay</b> on Cascade (or step ← / → through
            interactions). Open ⌘K → <b>Go live</b> to resume capture.
          </span>
        </div>
      </div>

      <div className="changelog">
        <article className="change">
          <span className="tag green">Rewinds</span>
          <h3>What travels</h3>
          <p>
            <code>useState</code>, <code>useReducer</code>, class state — and everything derived
            from them: computed values, class names, styles, context from a rewound provider.
          </p>
        </article>
        <article className="change">
          <span className="tag orange">Stays put</span>
          <h3>What doesn't</h3>
          <p>
            Refs, module state, uncontrolled inputs, server state, imperative DOM writes, and most
            external stores. Production builds have no override API, so the toggle is disabled
            there.
          </p>
        </article>
      </div>
    </section>
  );
}
