import { IconLens } from "@reactlens/icons";
import { ThemeToggle } from "../ThemeToggle.js";

const REPO = "https://github.com/Fausto95/react-lens";

export function SiteNav() {
  return (
    <header className="site-nav">
      <div className="site-nav-inner">
        <a className="site-nav-brand" href="#hero">
          <IconLens size={18} />
          <span>React Lens</span>
        </a>
        <nav className="site-nav-links" aria-label="Page">
          <a href="#time-travel">Rewind</a>
          <a href="#why">Trace</a>
          <a href="#diff">Diff</a>
          <a href="#agents">Agents</a>
        </nav>
        <div className="site-nav-actions">
          <ThemeToggle />
          <a className="btn ghost" href={REPO} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
        </div>
      </div>
    </header>
  );
}
