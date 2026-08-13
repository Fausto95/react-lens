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
        render, component, and line. This site is inspecting itself: everything on the right is this
        page’s real component tree.
      </p>
      <div className="cta-row">
        <a className="btn primary" href="#install">
          Install
        </a>
        <a className="btn" href="#features">
          Features
        </a>
        <a className="btn" href={REPO} target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
      </div>
    </section>
  );
}
