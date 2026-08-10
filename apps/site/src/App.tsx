import { Hero } from "./sections/Hero.js";
import { FiveQuestions } from "./sections/FiveQuestions.js";
import { TraceSection } from "./sections/TraceSection.js";
import { GraphSection } from "./sections/GraphSection.js";
import { DiffSection } from "./sections/DiffSection.js";
import { Install } from "./sections/Install.js";
import { Coachmark } from "./sections/Coachmark.js";

/**
 * The site is its own demo: every section below is a real component, so the
 * React Lens panel docked on the right shows THIS page's tree. Read the pitch
 * on the left; watch the tool dissect it on the right.
 */
export function App() {
  return (
    <main className="site">
      <Hero />
      <FiveQuestions />
      <TraceSection />
      <GraphSection />
      <DiffSection />
      <Install />
      <Coachmark />
    </main>
  );
}
