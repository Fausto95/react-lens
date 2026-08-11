interface Feature {
  tag: string;
  tone: "" | "green" | "orange";
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    tag: "AI Agent",
    tone: "green",
    title: "BYOK agent, grounded in the trace",
    body:
      "⌘I opens an in-panel assistant (OpenAI / Anthropic / Z.AI — your key stays in the browser) that answers through 12 typed tools over the live TraceStore. component_runtime hands it a component's timings, render reasons, wasted renders, compiler status and latest prop/hook values in one call; fixes are proposed against your real source via source maps. Every claim cites Lens IDs — clickable chips that jump to the exact render, component, or interaction.",
  },
  {
    tag: "Doctor",
    tone: "",
    title: "OXC AST Doctor, definition-aware",
    body:
      "Static analysis parses with oxc-parser (analyzeSourceAst) and prefers the AST, falling back to regex when it can't load. Rules — inline JSX Provider values, useEffect → setState — are scoped to a component's definition span, so findings are stamped file:line instead of a bare L42.",
  },
  {
    tag: "Effects",
    tone: "green",
    title: "Effect debugger with post-commit timing",
    body:
      "Instrumentation wraps effect create/destroy on commit and emits timed EffectEvents (run + cleanup + hookIndex) via onPostCommitFiberRoot. The Effects tab shows run/cleanup counts and durations, plus a “possible loop” badge when an effect fires on nearly every recent render.",
  },
  {
    tag: "Sessions",
    tone: "",
    title: "Shareable, persisted sessions",
    body:
      "The topbar (and ⌘K) export/import the whole TraceStore as a .json session file. Exports also save to IndexedDB (capped at 20), and ⌘K lists “Open · …” recent sessions to reload a trace instantly.",
  },
  {
    tag: "Waste",
    tone: "orange",
    title: "Proactive waste detection",
    body:
      "After an interaction settles, a banner appears when ≥5 renders produced no visible change. “Inspect” jumps straight to Potential-Waste mode and the worst offender.",
  },
  {
    tag: "Suspense · RSC",
    tone: "",
    title: "Suspense & Server Component awareness",
    body:
      "Instances carry a kind (suspense / server-boundary) and suspenseBoundaryId, with tree/inspector badges and a status-bar suspended count. A Flight client-reference heuristic detects react.client.reference / react.server.reference / lazy payloads and records rsc.role / moduleId / exportName, so the inspector distinguishes an RSC boundary from a server action from a lazy payload.",
  },
];

export function Features() {
  return (
    <section id="features">
      <div className="sec-kicker"><span className="dot" /> Features</div>
      <h2>Everything in the box.</h2>
      <p className="sec-lead">
        Beyond the three primitives — the capabilities that turn a trace into an
        explanation. Dig into any of these with the panel on the right, on this very page.
      </p>
      <div className="changelog">
        {FEATURES.map((f) => (
          <article className="change" key={f.title}>
            <span className={`tag ${f.tone}`}>{f.tag}</span>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
