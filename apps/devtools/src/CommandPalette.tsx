import { useMemo, useState, useEffect, useRef } from "react";
import type { TraceStore } from "@react-lens/trace-engine";
import type { ComponentId } from "@react-lens/protocol";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

type Item =
  | { kind: "command"; key: string; label: string; hint?: string; run: () => void }
  | { kind: "component"; key: string; label: string; id: ComponentId };

/** ⌘K palette: run commands or jump to a component by name. */
export function CommandPalette({
  store,
  commands,
  onSelectComponent,
  onClose,
}: {
  store: TraceStore;
  commands: Command[];
  onSelectComponent: (id: ComponentId) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const items = useMemo<Item[]>(() => {
    const lower = q.toLowerCase();
    const cmds: Item[] = commands
      .filter((c) => c.label.toLowerCase().includes(lower))
      .map((c) => ({ kind: "command", key: `cmd:${c.id}`, label: c.label, hint: c.hint, run: c.run }));
    const comps: Item[] = store
      .allInstances()
      .filter((i) => store.renderCount(i.id) > 0 && i.name.toLowerCase().includes(lower))
      .slice(0, 40)
      .map((i) => ({ kind: "component", key: `c:${i.id}`, label: i.name, id: i.id }));
    return [...cmds, ...comps];
  }, [q, commands, store]);

  const clampedActive = Math.min(active, Math.max(0, items.length - 1));

  const choose = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "command") item.run();
    else onSelectComponent(item.id);
    onClose();
  };

  return (
    <div className="rl-cmdk-backdrop" onClick={onClose}>
      <div className="rl-cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="rl-cmdk-input"
          placeholder="Run a command or jump to a component…"
          value={q}
          spellCheck={false}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(items[clampedActive]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="rl-cmdk-list">
          {items.length === 0 ? (
            <div className="rl-empty">No matches.</div>
          ) : (
            items.map((item, i) => (
              <div
                key={item.key}
                className={`rl-cmdk-item${i === clampedActive ? " active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
              >
                <span className={`rl-cmdk-kind ${item.kind}`}>
                  {item.kind === "command" ? "⌘" : "◈"}
                </span>
                <span className="rl-cmdk-label">{item.label}</span>
                {item.kind === "command" && item.hint && (
                  <span className="rl-cmdk-hint">{item.hint}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
