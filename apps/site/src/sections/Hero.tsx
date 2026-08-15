import { IconLens } from "@reactlens/icons";

const REPO = "https://github.com/Fausto95/react-lens";

export function Hero() {
  return (
    <section id="hero" className="hero">
      <div className="hero-brand">
        <IconLens size={18} /> React Lens
      </div>
      <h1>
        See every render. <span className="accent">Follow every cause.</span>
      </h1>
      <p className="hero-sub">
        Time-travel through real React state, inspect interactions on a professional timeline, and
        trace render cascades from the event that started them to the components that paid the cost.
        Human or AI agent — every conclusion stays grounded in Lens evidence.
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
