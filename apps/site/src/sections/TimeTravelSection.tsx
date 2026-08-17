import { useReducer, useState, useSyncExternalStore } from "react";
import { createStoreAdapter, registerStores } from "@reactlens/adapters";

/**
 * State living outside React entirely — the case the adapter seam exists for.
 * A plain module singleton here rather than a library, so the claim on this page
 * is demonstrated without shipping Zustand to a marketing site; the registration
 * is the same one line either way.
 */
let likes = 0;
const likeListeners = new Set<() => void>();
const likeStore = {
  get: (): number => likes,
  set: (next: number): void => {
    likes = next;
    for (const l of likeListeners) l();
  },
  subscribe: (l: () => void): (() => void) => {
    likeListeners.add(l);
    return () => {
      likeListeners.delete(l);
    };
  },
};

registerStores(createStoreAdapter<number>({ id: "likes", get: likeStore.get, set: likeStore.set }));

/**
 * Live specimen for real time travel. React state and the registered store both
 * rewind; the uncontrolled input is deliberate — it demonstrates the documented
 * limit that DOM-only state stays put when the playhead moves.
 */
function TimeMachineSpecimen() {
  const [count, setCount] = useState(0);
  const likeCount = useSyncExternalStore(likeStore.subscribe, likeStore.get);
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
      <button className="btn" onClick={() => likeStore.set(likeCount + 1)}>
        store: {likeCount}
      </button>
      <input className="spec-input" placeholder="uncontrolled — won't rewind" />
      <span className="tag">state + registered store rewind · this input doesn't</span>
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
        every commit and puts it back through React’s own override API. Zustand, Redux and TanStack
        Query come along too, through one registration.
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
            from them: computed values, class names, styles, context from a rewound provider. Plus
            any store you register with <code>@reactlens/adapters</code>: Zustand, Redux, TanStack
            Query, or a get/set pair of your own.
          </p>
        </article>
        <article className="change">
          <span className="tag orange">Stays put</span>
          <h3>What doesn't</h3>
          <p>
            Refs, uncontrolled inputs, imperative DOM writes, and unregistered module state — an
            external store rewinds only once you opt it in. Production builds have no override API,
            so the toggle is disabled there.
          </p>
        </article>
      </div>
    </section>
  );
}
