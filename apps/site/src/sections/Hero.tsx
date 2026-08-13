import { IconLens } from "@reactlens/icons";

const REPO = "https://github.com/Fausto95/react-lens";

export function Hero() {
  return (
    <section id="hero" className="hero">
      <div className="hero-brand">
        <IconLens size={18} /> React Lens
      </div>
      <h1>
        React debugging with <span className="accent">receipts</span>.
      </h1>
      <p className="hero-sub">
        Time travel through real state. Trace any value to its source. Simulate the fix before you
        make it. Bisect the commit that broke perf. Human or AI agent — every answer cites the exact
        render, component, and line.
      </p>
      <div className="cta-row">
        <a
          className="btn primary"
          href="https://github.com/Fausto95/react-lens/blob/main/docs/getting-started.md"
          target="_blank"
          rel="noreferrer"
        >
          Install
        </a>
        <a className="btn" href="#features">
          Features
        </a>
        <a className="btn" href={REPO} target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
      </div>
      <p className="hero-meta">
        <span className="live" />
        Live — this page is inspecting itself
      </p>
    </section>
  );
}
