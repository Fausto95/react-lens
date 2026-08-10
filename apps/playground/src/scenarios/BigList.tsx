import { useState, useMemo } from "react";
import { Section, btn } from "./ui.js";

const BIG = 600;

/** Hundreds of Row components — tests virtualization + repeated grouping. */
export function BigList() {
  const [q, setQ] = useState("");
  const rows = useMemo(
    () =>
      Array.from({ length: BIG }, (_, i) => ({ id: i, label: `Row ${i}` })).filter((r) =>
        r.label.includes(q),
      ),
    [q],
  );
  return (
    <Section
      title={`Big List (${BIG})`}
      hint="Hundreds of Row components — test tree virtualization and repeated-component grouping (Row ×N)."
    >
      <input
        style={{ ...btn, cursor: "text", width: 200 }}
        placeholder="filter rows…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div style={{ maxHeight: 200, overflow: "auto", marginTop: 12, display: "grid", gap: 2 }}>
        {rows.map((r) => (
          <Row key={r.id} label={r.label} />
        ))}
      </div>
    </Section>
  );
}

function Row({ label }: { label: string }) {
  return <div style={{ padding: "3px 8px", fontSize: 12, borderBottom: "1px solid #f2f3f5" }}>{label}</div>;
}
