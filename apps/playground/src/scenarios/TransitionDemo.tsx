import { useState, useTransition, useMemo } from "react";
import { Section, btn } from "./ui.js";

/** useTransition: typing updates urgent input immediately while the heavy list
 *  updates in a low-priority transition. isPending shows in the State/Hooks
 *  inspector sections. */
export function TransitionDemo() {
  const [query, setQuery] = useState("");
  const [deferred, setDeferred] = useState("");
  const [isPending, startTransition] = useTransition();

  const onChange = (v: string) => {
    setQuery(v); // urgent
    startTransition(() => setDeferred(v)); // deferred
  };

  return (
    <Section
      title="Transition"
      hint="Type to filter — the input stays responsive while the list updates in a transition. isPending is visible in the inspector."
    >
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

function SlowList({ filter }: { filter: string }) {
  const items = useMemo(
    () =>
      Array.from({ length: 200 }, (_, i) => `Item ${i}`).filter((s) =>
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

function SlowRow({ label }: { label: string }) {
  // A little work per row so the transition is observable.
  let acc = 0;
  for (let i = 0; i < 8000; i++) acc += i % 3;
  return (
    <div style={{ padding: "2px 8px", fontSize: 12 }} data-acc={acc}>
      {label}
    </div>
  );
}
