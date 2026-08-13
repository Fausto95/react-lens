import { useState } from "react";
import { Button, Card, Section, Stack } from "@reactlens/demo-ui";

/**
 * Equal-value new object props: identity changes, screen does not — wasted renders.
 * Name + "Refresh prices" button matter for capture / doctor / waste specs.
 */
export function WasteDemo() {
  const [prices, setPrices] = useState({ a: 10, b: 20 });
  const [tick, setTick] = useState(0);

  return (
    <Section
      kicker="Inventory"
      title="Price sync"
      hint="Refresh prices rebuilds equal-value objects. Force re-render fans out WasteItem."
    >
      <Stack row>
        <Button size="sm" onClick={() => setPrices((p) => ({ ...p }))}>
          Refresh prices
        </Button>
        <Button size="sm" variant="primary" onClick={() => setTick((t) => t + 1)}>
          Force re-render (×{tick})
        </Button>
      </Stack>
      <div style={{ marginTop: 12 }}>
        <WasteChild prices={prices} />
      </div>
      <div className="demo-pill-row" style={{ marginTop: 12 }}>
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
    <Card>
      <span className="demo-meta">
        prices a={prices.a} b={prices.b}
      </span>
    </Card>
  );
}
WasteChild.displayName = "WasteChild";

function WasteItem({ index, epoch }: { index: number; epoch: number }) {
  let acc = 0;
  for (let i = 0; i < 2_000 + (epoch % 17); i++) acc += Math.sqrt(i);
  return (
    <div
      className="demo-badge demo-badge-neutral"
      style={{ minWidth: 36, justifyContent: "center" }}
      data-sink={acc >= 0 ? undefined : String(acc)}
    >
      #{index}
    </div>
  );
}
WasteItem.displayName = "WasteItem";
