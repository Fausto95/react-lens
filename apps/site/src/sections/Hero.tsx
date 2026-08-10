import { IconLens } from "@react-lens/icons";

const REPO = "https://github.com/Fausto95/react-lens";

export function Hero() {
  return (
    <section id="hero" className="hero">
      <div className="hero-brand">
        <IconLens size={18} /> React Lens
      </div>
      <h1>
        See <span className="accent">why</span> your React app behaves the way it does.
      </h1>
      <p className="hero-sub">
        React observability for development. This site is inspecting itself — the panel
        on the right is React Lens, running live on the page you're reading. Everything
        it shows is this page's real component tree.
      </p>
      <div className="cta-row">
        <a className="btn primary" href="#features">Features</a>
        <a className="btn" href={REPO} target="_blank" rel="noreferrer">GitHub ↗</a>
      </div>
    </section>
  );
}
