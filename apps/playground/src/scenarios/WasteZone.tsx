import { useState } from "react";
import { Section, btn } from "./ui.js";

/** Force renders that produce no DOM change → Potential Waste + Doctor fanout. */
export function WasteZone() {
  const [tick, setTick] = useState(0);
  return (
    <Section
      title="Waste Zone"
      hint="Force renders that produce no DOM change → Potential Waste tree mode + Doctor render-fanout."
    >
      <button style={btn} onClick={() => setTick((t) => t + 1)}>
        Force re-render (×{tick})
      </button>
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6, marginTop: 12 }}
      >
        {Array.from({ length: 30 }, (_, i) => (
          <WasteItem key={i} index={i} epoch={tick} />
        ))}
      </div>
    </Section>
  );
}

function WasteItem({ index }: { index: number; epoch: number }) {
  return (
    <div
      style={{
        padding: 8,
        borderRadius: 6,
        background: "#f2f3f5",
        textAlign: "center",
        fontSize: 12,
      }}
    >
      #{index}
    </div>
  );
}
