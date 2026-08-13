import { useState } from "react";
import { Button, Card, Section, Stack } from "@reactlens/demo-ui";

/** Heavy synchronous render work — drives overlay flashes and Doctor self-time. */
export function Expensive() {
  const [tick, setTick] = useState(0);
  return (
    <Section kicker="Perf" title="Heavy compute" hint="Self-time for overlay + Doctor.">
      <Button size="sm" onClick={() => setTick((t) => t + 1)}>
        Re-render (×{tick})
      </Button>
      <Stack row style={{ marginTop: 12 }}>
        <Heavy iterations={2_000_000} label="Heavy A" />
        <Heavy iterations={3_000_000} label="Heavy B" />
      </Stack>
    </Section>
  );
}
Expensive.displayName = "Expensive";

function Heavy({ iterations, label }: { iterations: number; label: string }) {
  let acc = 0;
  for (let i = 0; i < iterations; i++) acc += Math.sqrt(i) % 7;
  return (
    <Card style={{ flex: 1, minWidth: 140 }}>
      <strong>{label}</strong>
      <div className="demo-meta">
        {iterations.toLocaleString()} ops → {acc.toFixed(1)}
      </div>
    </Card>
  );
}
Heavy.displayName = "Heavy";
