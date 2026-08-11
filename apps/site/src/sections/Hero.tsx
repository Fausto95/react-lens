import { IconLens } from "@reactlens/icons";

const REPO = "https://github.com/Fausto95/react-lens";

export function Hero() {
  return (
    <section id="hero" className="hero">
      <div className="hero-brand">
        <IconLens size={18} /> React Lens
      </div>
      <h1>
        Rewind any render. Then ask <span className="accent">why</span>.
      </h1>
      <p className="hero-sub">
        React Lens replays your app’s real state at any commit — then a trace-grounded AI agent
        answers, citing the exact render, component, and line. This site is inspecting itself:
        everything on the right is this page’s real component tree.
      </p>
      <div className="cta-row">
        <a className="btn primary" href="#features">
          Features
        </a>
        <a className="btn" href={REPO} target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
      </div>
    </section>
  );
}
