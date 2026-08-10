import { createContext, useContext, useState } from "react";

const ThemeContext = createContext(0);
const SWATCHES = ["violet", "green", "cyan", "orange"];

/** A consumer — re-renders when the context value changes (the fanout). */
function Consumer({ label }: { label: string }) {
  const theme = useContext(ThemeContext);
  return <span className="chip lit">{label}: {SWATCHES[theme]}</span>;
}

/** Provider specimen: cycling the value re-renders all consumers below it. */
function GraphSpecimen() {
  const [theme, setTheme] = useState(0);
  return (
    <ThemeContext.Provider value={theme}>
      <div className="spec-row">
        <button className="btn" onClick={() => setTheme((t) => (t + 1) % SWATCHES.length)}>
          Cycle context
        </button>
        <span className="spec-stat">consumers: <b>4</b></span>
      </div>
      <div className="chips">
        <Consumer label="Header" />
        <Consumer label="Sidebar" />
        <Consumer label="Card" />
        <Consumer label="Footer" />
      </div>
    </ThemeContext.Provider>
  );
}

export function GraphSection() {
  return (
    <section id="graph">
      <div className="sec-kicker"><span className="dot" /> GRAPH · why</div>
      <h2>Follow the cause, not the symptom.</h2>
      <p className="sec-lead">
        Cycle the context and select a <code>Consumer</code> in the panel — “Why this
        render” names the exact cause (the <code>ThemeContext</code> value changed) and
        the fanout across every consumer, so you fix the source, not each leaf.
      </p>
      <div className="card">
        <GraphSpecimen />
        <div className="card-hint">▶ One context change → four consumer renders.</div>
      </div>
    </section>
  );
}
