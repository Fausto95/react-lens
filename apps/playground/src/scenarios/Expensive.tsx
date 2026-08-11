import { useState } from "react";
import { Section, btn } from "./ui.js";

/** Components that do real synchronous work in render → high self-time (red
 *  heat, flame bars, Doctor). Deterministic busy-work, not a timer. */
export function Expensive() {
  const [tick, setTick] = useState(0);
  return (
    <Section
      title="Expensive Components"
      hint="Each does heavy synchronous work in render — watch self-time, red flame bars, and the render overlay."
    >
      <button style={btn} onClick={() => setTick((t) => t + 1)}>
        Re-render (×{tick})
      </button>
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <Heavy iterations={4_000_000} label="Heavy A" />
        <Heavy iterations={8_000_000} label="Heavy B" />
        <Heavy iterations={2_000_000} label="Heavy C" />
      </div>
    </Section>
  );
}

function Heavy({ iterations, label }: { iterations: number; label: string }) {
  // Intentionally expensive work during render.
  let acc = 0;
  for (let i = 0; i < iterations; i++) acc += Math.sqrt(i) % 7;
  return (
    <div
      style={{ padding: 12, borderRadius: 8, background: "#fff3f0", border: "1px solid #f6d0c6" }}
    >
      <strong>{label}</strong>
      <div style={{ color: "#5f6878", fontSize: 12 }}>
        {iterations.toLocaleString()} ops → {acc.toFixed(1)}
      </div>
    </div>
  );
}
