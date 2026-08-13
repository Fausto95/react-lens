import { useMemo, useState, useTransition } from "react";
import { Input, Meta, Section, Stack } from "@reactlens/demo-ui";

export function TransitionDemo() {
  const [query, setQuery] = useState("");
  const [deferred, setDeferred] = useState("");
  const [isPending, startTransition] = useTransition();

  const onChange = (v: string) => {
    setQuery(v);
    startTransition(() => setDeferred(v));
  };

  return (
    <Section
      kicker="Search"
      title="Catalog filter"
      hint="Typing updates urgently; the list updates in a transition."
    >
      <Stack row>
        <Input
          style={{ width: 220 }}
          placeholder="filter (transition)…"
          value={query}
          onChange={(e) => onChange(e.target.value)}
        />
        <Meta>{isPending ? "updating…" : "idle"}</Meta>
      </Stack>
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
    <div className="demo-list">
      {items.map((label, i) => (
        <SlowRow key={i} label={label} />
      ))}
    </div>
  );
}
SlowList.displayName = "SlowList";

function SlowRow({ label }: { label: string }) {
  let acc = 0;
  for (let i = 0; i < 400; i++) acc += i % 3;
  return (
    <div className="demo-list-row" data-acc={acc}>
      {label}
    </div>
  );
}
SlowRow.displayName = "SlowRow";
