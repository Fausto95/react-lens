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
        <span className="dot" /> WHY · cause, then fix
      </div>
      <h2>Trace a render to its cause.</h2>
      <p className="sec-lead">
        Cycle the context and select a <code>Consumer</code> in the panel: Cascade draws the fanout,
        the cause chain names the exact reason, and source maps plus Doctor findings land on{" "}
        <code>file:line</code>. Receipts, not guesses.
      </p>

      <div className="card">
        <CauseSpecimen />
        <div className="card-hint">
          <span>▶ One context change → four consumer renders on Cascade.</span>
        </div>
      </div>

      <div className="changelog">
        <article className="change">
          <span className="tag">Cause chain</span>
          <h3>Props, state, hooks, or parent</h3>
          <p>
            Every render gets a ranked cause with diff evidence and a confidence level — including a
            “no observable change” verdict when it was avoidable. Compiler bailouts count as
            evidence; recommendations stay evidence-backed.
          </p>
        </article>
        <article className="change">
          <span className="tag green">AI agent, BYOK</span>
          <h3>Ask in words, get Lens IDs back</h3>
          <p>
            <kbd>⌘I</kbd> opens an assistant that answers through typed tools over the live trace
            (OpenAI / Anthropic / Z.AI — your key is encrypted in the browser). Claims cite clickable Lens
            IDs; the agent can propose fixes citing <code>file:line</code> against your source.
          </p>
        </article>
      </div>
    </section>
  );
}
