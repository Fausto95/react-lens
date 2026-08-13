import { useState } from "react";
import { Section, btn } from "./ui.js";

/** Heavy synchronous render work — drives overlay flashes and Doctor self-time. */
export function Expensive() {
  const [tick, setTick] = useState(0);
  return (
    <Section title="Expensive" hint="Heavy render work for overlay + Doctor.">
      <button type="button" style={btn} onClick={() => setTick((t) => t + 1)}>
        Re-render (×{tick})
      </button>
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <Heavy iterations={2_000_000} label="Heavy A" />
        <Heavy iterations={3_000_000} label="Heavy B" />
      </div>
    </Section>
  );
}
Expensive.displayName = "Expensive";

function Heavy({ iterations, label }: { iterations: number; label: string }) {
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
Heavy.displayName = "Heavy";
