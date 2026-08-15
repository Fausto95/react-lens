import { createContext, useContext, useState } from "react";

const ThemeContext = createContext(0);
const SWATCHES = ["violet", "green", "cyan", "orange"];

/** A consumer — re-renders when the context value changes (the fanout). */
function Consumer({ label }: { label: string }) {
  const theme = useContext(ThemeContext);
  return (
    <span className="chip lit">
      {label}: {SWATCHES[theme]}
    </span>
  );
}

/** Provider specimen: cycling the value re-renders all consumers below it. */
function CauseSpecimen() {
  const [theme, setTheme] = useState(0);
  return (
    <ThemeContext.Provider value={theme}>
      <div className="spec-row">
        <button className="btn" onClick={() => setTheme((t) => (t + 1) % SWATCHES.length)}>
          Cycle context
        </button>
        <span className="spec-stat">
          consumers: <b>4</b>
        </span>
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

export function WhySection() {
  return (
    <section id="why">
      <div className="sec-kicker">
        <span className="dot" /> CASCADE · cause, fanout, cost
      </div>
      <h2>See how one change becomes a render cascade.</h2>
      <p className="sec-lead">
        Pick an interaction and switch to Cascade: React Lens projects its renders into a causal
        graph, preserving order and cause so you can follow the path from the trigger to every
        component that re-rendered. Focus expensive work, roots, or a custom path without losing the
        surrounding graph.
      </p>

      <div className="card">
        <CauseSpecimen />
        <div className="card-hint">
          <span>▶ One context change → four consumers. Timeline shows when; Cascade shows why.</span>
        </div>
      </div>

      <div className="changelog">
        <article className="change">
          <span className="tag">Causal graph</span>
          <h3>Props, state, context, parent</h3>
          <p>
            Nodes carry the render cause and edges preserve the fanout. Pan, zoom, fit, use the
            minimap, and focus upstream/downstream paths to turn a large interaction into a readable
            explanation.
          </p>
        </article>
        <article className="change">
          <span className="tag green">AI agent, BYOK</span>
          <h3>Ask in words, get Lens IDs back</h3>
          <p>
            <kbd>⌘I</kbd> opens an assistant that answers through typed tools over the live trace
            (OpenAI / Anthropic / Z.AI — your key stays in the browser). Claims cite clickable Lens
            IDs and source locations instead of inventing a diagnosis.
          </p>
        </article>
      </div>
    </section>
  );
}
