import { IconLens } from "@react-lens/icons";

const REPO = "https://github.com/Fausto95/react-lens";

export function Hero() {
  return (
    <section id="hero" className="hero">
      <div className="hero-brand">
        <IconLens size={18} /> React Lens
      </div>
      <h1>
        Know <span className="accent">why</span> every render happened.
      </h1>
      <p className="hero-sub">
        Dev-time React observability — from interaction to cause to fix, in one panel.
        This site is inspecting itself: everything on the right is this page’s real
        component tree.
      </p>
      <div className="cta-row">
        <a className="btn primary" href="#features">Features</a>
        <a className="btn" href={REPO} target="_blank" rel="noreferrer">GitHub ↗</a>
      </div>
    </section>
  );
}
