import { useState } from "react";
import { Section, btn } from "./ui.js";

/**
 * Equal-value new object props: identity changes, screen does not — wasted renders.
 * Name + "Refresh prices" button matter for capture / doctor / waste specs.
 */
export function WasteDemo() {
  const [prices, setPrices] = useState({ a: 10, b: 20 });
  const [tick, setTick] = useState(0);

  return (
    <Section
      title="Waste"
      hint="Refresh prices rebuilds equal-value objects. Force re-render fans out WasteItem."
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={btn} onClick={() => setPrices((p) => ({ ...p }))}>
          Refresh prices
        </button>
        <button type="button" style={btn} onClick={() => setTick((t) => t + 1)}>
          Force re-render (×{tick})
        </button>
      </div>
      <div style={{ marginTop: 12 }}>
        <WasteChild prices={prices} />
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6, marginTop: 12 }}
      >
        {Array.from({ length: 24 }, (_, i) => (
          <WasteItem key={i} index={i} epoch={tick} />
        ))}
      </div>
    </Section>
  );
}
WasteDemo.displayName = "WasteDemo";

function WasteChild({ prices }: { prices: { a: number; b: number } }) {
  return (
    <div style={{ fontSize: 13, color: "#5f6878" }}>
      prices a={prices.a} b={prices.b}
    </div>
  );
}
WasteChild.displayName = "WasteChild";

function WasteItem({ index, epoch }: { index: number; epoch: number }) {
  // Real work keyed on epoch so the Compiler cannot bail out; DOM stays identical
  // (`#{index}` only) — the waste the banner / Doctor are looking for.
  let acc = 0;
  for (let i = 0; i < 2_000 + (epoch % 17); i++) acc += Math.sqrt(i);
  return (
    <div
      style={{
        padding: 8,
        borderRadius: 6,
        background: "#f2f3f5",
        textAlign: "center",
        fontSize: 12,
      }}
      data-sink={acc >= 0 ? undefined : String(acc)}
    >
      #{index}
    </div>
  );
}
WasteItem.displayName = "WasteItem";
