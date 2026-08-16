import { Hero } from "./sections/Hero.js";
import { SiteNav } from "./sections/SiteNav.js";
import { TimeTravelSection } from "./sections/TimeTravelSection.js";
import { WhySection } from "./sections/WhySection.js";
import { CascadeSection } from "./sections/CascadeSection.js";
import { ChangeSection } from "./sections/ChangeSection.js";
import { Features } from "./sections/Features.js";
import { AgentsSection } from "./sections/AgentsSection.js";
import { Coachmark } from "./sections/Coachmark.js";
import { Reveal } from "./Reveal.js";

/**
 * The site is its own demo: every section below is a real component, so the
 * React Lens panel docked on the right shows THIS page's tree. Full-bleed
 * hero first, then pillars (rewind → trace → cascade → diff), features, agents.
 */
export function App() {
  return (
    <div className="site-shell">
      <SiteNav />
      <main className="site">
        <Hero />
        <Reveal>
          <TimeTravelSection />
        </Reveal>
        <Reveal>
          <WhySection />
        </Reveal>
        <Reveal>
          <CascadeSection />
        </Reveal>
        <Reveal>
          <ChangeSection />
        </Reveal>
        <Reveal>
          <Features />
        </Reveal>
        <Reveal>
          <AgentsSection />
        </Reveal>
        <Coachmark />
      </main>
    </div>
  );
}
