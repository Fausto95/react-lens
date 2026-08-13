import { useMemo, useState } from "react";
import { Input, Section } from "@reactlens/demo-ui";

const BIG = 400;

/** Hundreds of Row components — tree virtualization + filter. */
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
      kicker="Catalog"
      title={`Full listing (${BIG})`}
      hint="Many Row components for virtualization / filter."
    >
      <Input
        style={{ width: 220 }}
        placeholder="filter rows…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="demo-list">
        {rows.map((r) => (
          <Row key={r.id} label={r.label} />
        ))}
      </div>
    </Section>
  );
}
BigList.displayName = "BigList";

function Row({ label }: { label: string }) {
  return <div className="demo-list-row">{label}</div>;
}
Row.displayName = "Row";
