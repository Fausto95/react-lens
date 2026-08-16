interface Feature {
  title: string;
  body: string;
}

/** One line each — the sections above carry the depth. */
const FEATURES: Feature[] = [
  {
    title: "Cascade",
    body: "Causal render graph for the selected interaction — Fit / 1:1, focus modes, Cause / Effects, aggregation, minimap, and replay transport on one toolbar.",
  },
  {
    title: "Bidirectional selection",
    body: "Pick an element on the page (⌘\\) to select it in the tree; selecting in the panel outlines it and scrolls off-screen targets into view.",
  },
  {
    title: "⌘K search",
    body: "Command palette plus a structured filter language — renders:>20, wasted:true, compiled:false — so the tree answers questions, not just names.",
  },
  {
    title: "Replay with fix",
    body: "Preview the panel tree with wasted renders hidden. Fix with AI opens the BYOK agent on a Doctor finding — it proposes a patch; it does not write to disk.",
  },
  {
    title: "Waste detection",
    body: "After an interaction settles, a banner flags renders that produced no visible change and jumps you to the worst offender.",
  },
  {
    title: "AST Doctor",
    body: "Static analysis fused with runtime evidence, scoped to a component's definition span. OXC when available; the in-panel Doctor falls back to regex.",
  },
  {
    title: "Effect debugger",
    body: "Timed effect run/cleanup events with durations, plus a “possible loop” badge when an effect fires on nearly every render.",
  },
  {
    title: "Suspense & RSC aware",
    body: "Suspense boundaries, server-component roles, and server actions are detected from client fiber heuristics and badged in the tree and inspector.",
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
    body: "markInteraction + Playwright helpers to name a window; export sessions, then compare_sessions / react-lens ci on matching files.",
  },
  {
    title: "React 19 + Compiler",
    body: "Compiled components are badged ✓ and compiler bailouts are first-class evidence — recommendations stay evidence-backed.",
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
