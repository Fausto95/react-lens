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
    title: "⌘K search",
    body: "Command palette plus a structured filter language — renders:>20, wasted:true, compiled:false — so the tree answers questions, not just names.",
  },
  {
    title: "Replay with fix",
    body: "Preview the tree without wasted renders before you change code; Fix with AI proposes a patch against real source at file:line.",
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
    body: "Suspense boundaries, server-component roles, and server actions are detected and badged in the tree and inspector — server to pixel.",
  },
  {
    title: "Sessions",
    body: "Export or import the whole trace as a .json file; recent sessions persist in IndexedDB and reload from ⌘K.",
  },
  {
    title: "CLI & MCP",
    body: "react-lens analyze, mcp, and ci — the same typed tools as the panel agent, over a session file for hosts and CI.",
  },
  {
    title: "Named-interaction CI",
    body: "markInteraction + Playwright helpers + compare_sessions / react-lens ci to catch perf regressions by interaction name.",
  },
  {
    title: "React 19 + Compiler",
    body: "Compiled components are badged ◆ and compiler bailouts are first-class evidence — recommendations stay evidence-backed.",
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
