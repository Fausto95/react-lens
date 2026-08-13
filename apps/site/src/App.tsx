import { Hero } from "./sections/Hero.js";
import { TimeTravelSection } from "./sections/TimeTravelSection.js";
import { WhySection } from "./sections/WhySection.js";
import { ChangeSection } from "./sections/ChangeSection.js";
import { Features } from "./sections/Features.js";
import { InstallSection } from "./sections/InstallSection.js";
import { AgentsSection } from "./sections/AgentsSection.js";
import { Coachmark } from "./sections/Coachmark.js";

/**
 * The site is its own demo: every section below is a real component, so the
 * React Lens panel docked on the right shows THIS page's tree. Pillars first
 * (time travel → trace → diff), then the feature grid, then install + agents.
 * Read the pitch on the left; watch the tool dissect it on the right.
 */
export function App() {
  return (
    <main className="site">
      <Hero />
      <TimeTravelSection />
      <WhySection />
      <ChangeSection />
      <Features />
      <InstallSection />
      <AgentsSection />
      <Coachmark />
    </main>
  );
}
