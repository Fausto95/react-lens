import { useState } from "react";
import { btn } from "./ui.js";

/** Isolated widgets — each holds its own state, producing a distinct commit. */
export function Toolbar() {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
      <Ticker />
      <Ticker />
      <Toggle />
    </div>
  );
}

let tickerSeq = 0;
function Ticker() {
  const label = useState(() => `Ticker ${++tickerSeq}`)[0];
  const [n, setN] = useState(0);
  return (
    <button style={btn} onClick={() => setN((v) => v + 1)}>
      {label}: {n}
    </button>
  );
}

function Toggle() {
  const [on, setOn] = useState(false);
  return (
    <button style={btn} onClick={() => setOn((v) => !v)}>
      Toggle: {on ? "on" : "off"}
    </button>
  );
}
