interface Feature {
  title: string;
  body: string;
}

/** One line each — the sections above carry the depth. */
const FEATURES: Feature[] = [
  {
    title: "Interaction timeline",
    body: "A normalized log of commits and interactions, grouped into the things you actually did, with real self-time per component.",
  },
  {
    title: "Bidirectional selection",
    body: "Pick an element on the page (⌘\\) to select it in the tree; select anything in the panel and the page scrolls to it and outlines it — off-screen only.",
  },
  {
    title: "Waste detection",
    body: "After an interaction settles, a banner flags renders that produced no visible change and jumps you to the worst offender.",
  },
  {
    title: "AST Doctor",
    body: "oxc-parser static analysis fused with runtime evidence, scoped to a component's definition span, so findings land on file:line.",
  },
  {
    title: "Effect debugger",
    body: "Timed effect run/cleanup events with durations, plus a “possible loop” badge when an effect fires on nearly every render.",
  },
  {
    title: "Suspense & RSC aware",
    body: "Suspense boundaries, server-component roles, and server actions are detected and badged in the tree and inspector.",
  },
  {
    title: "Sessions",
    body: "Export or import the whole trace as a .json file; recent sessions persist in IndexedDB and reload from ⌘K.",
  },
  {
    title: "React 19 + Compiler",
    body: "Compiled components are badged ◆ and compiler bailouts are first-class evidence — never a nudge to hand-memoize.",
  },
];

export function Features() {
  return (
    <section id="features">
      <div className="sec-kicker">
        <span className="dot" /> Features
      </div>
      <h2>Everything else in the box.</h2>
      <div className="feats">
        {FEATURES.map((f) => (
          <article className="feat" key={f.title}>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
