import { useMemo, useState } from "react";

/**
 * Scale scenario: thousands of list rows that re-render on a shared clock tick.
 * Used to exercise columnar timeline + tree virtualization under load.
 */
const ROW_COUNT = 2_000;

export function OpsBoard() {
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState("");
  const rows = useMemo(
    () =>
      Array.from({ length: ROW_COUNT }, (_, i) => ({
        id: i,
        label: `Job ${i}`,
        status: (i + tick) % 5 === 0 ? "hot" : "idle",
      })),
    [tick],
  );
  const visible = filter
    ? rows.filter((r) => r.label.includes(filter) || r.status.includes(filter))
    : rows;

  return (
    <section className="demo-card" data-testid="ops-board">
      <header className="demo-card-head">
        <h2>Ops board</h2>
        <p>
          {ROW_COUNT.toLocaleString()} rows · tick {tick} · showing{" "}
          {visible.length.toLocaleString()}
        </p>
      </header>
      <div className="demo-card-actions">
        <button type="button" data-testid="ops-tick" onClick={() => setTick((t) => t + 1)}>
          Tick (re-render all)
        </button>
        <button
          type="button"
          data-testid="ops-burst"
          onClick={() => {
            for (let i = 0; i < 30; i++) setTick((t) => t + 1);
          }}
        >
          Burst ×30
        </button>
        <input
          data-testid="ops-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
        />
      </div>
      <ul className="demo-ops-list" style={{ maxHeight: 240, overflow: "auto" }}>
        {visible.slice(0, 80).map((r) => (
          <OpsRow key={r.id} label={r.label} status={r.status} tick={tick} />
        ))}
      </ul>
      <p className="demo-muted">List DOM capped at 80; all {ROW_COUNT} still re-render on tick.</p>
    </section>
  );
}

function OpsRow({ label, status, tick }: { label: string; status: string; tick: number }) {
  // Intentionally unstable child so each parent tick creates work.
  const noise = Math.sin(tick + label.length) * 0.0001;
  return (
    <li data-status={status}>
      {label} · {status} · {noise.toFixed(6)}
    </li>
  );
}
