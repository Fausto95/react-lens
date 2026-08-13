import { useMemo, useState, useTransition } from "react";
import { Section, btn } from "./ui.js";

export function TransitionDemo() {
  const [query, setQuery] = useState("");
  const [deferred, setDeferred] = useState("");
  const [isPending, startTransition] = useTransition();

  const onChange = (v: string) => {
    setQuery(v);
    startTransition(() => setDeferred(v));
  };

  return (
    <Section title="Transition" hint="Typing updates urgently; the list updates in a transition.">
      <input
        style={{ ...btn, cursor: "text", width: 200 }}
        placeholder="filter (transition)…"
        value={query}
        onChange={(e) => onChange(e.target.value)}
      />
      <span style={{ marginLeft: 8, color: isPending ? "#fb923c" : "#a0a6b2", fontSize: 12 }}>
        {isPending ? "updating…" : "idle"}
      </span>
      <SlowList filter={deferred} />
    </Section>
  );
}
TransitionDemo.displayName = "TransitionDemo";

function SlowList({ filter }: { filter: string }) {
  const items = useMemo(
    () =>
      Array.from({ length: 80 }, (_, i) => `Item ${i}`).filter((s) =>
        s.toLowerCase().includes(filter.toLowerCase()),
      ),
    [filter],
  );
  return (
    <div style={{ maxHeight: 140, overflow: "auto", marginTop: 12, display: "grid", gap: 2 }}>
      {items.map((label, i) => (
        <SlowRow key={i} label={label} />
      ))}
    </div>
  );
}
SlowList.displayName = "SlowList";

function SlowRow({ label }: { label: string }) {
  // Enough work to keep transitions pending under test, not enough to freeze CI.
  let acc = 0;
  for (let i = 0; i < 400; i++) acc += i % 3;
  return (
    <div style={{ padding: "2px 8px", fontSize: 12 }} data-acc={acc}>
      {label}
    </div>
  );
}
SlowRow.displayName = "SlowRow";
