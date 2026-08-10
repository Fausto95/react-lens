import { useMemo, useState, useEffect, useRef } from "react";
import type { TraceStore } from "@react-lens/trace-engine";
import type { ComponentId } from "@react-lens/protocol";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  /** Group heading in the palette (Navigate / Session / Timeline / …). */
  group?: string;
  run: () => void;
}

type Item =
  | {
      kind: "command";
      key: string;
      label: string;
      hint?: string;
      group: string;
      run: () => void;
    }
  | { kind: "component"; key: string; label: string; id: ComponentId; group: string }
  | { kind: "header"; key: string; label: string };

const GROUP_ORDER = ["Timeline", "Session", "Navigate", "Components"];

/** ⌘K palette: grouped commands + jump to component by name. */
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

  const flat = useMemo(() => {
    const lower = q.toLowerCase();
    const cmds = commands
      .filter((c) => c.label.toLowerCase().includes(lower))
      .map((c) => ({
        kind: "command" as const,
        key: `cmd:${c.id}`,
        label: c.label,
        hint: c.hint,
        group: c.group ?? "Navigate",
        run: c.run,
      }));
    const comps = store
      .allInstances()
      .filter((i) => store.renderCount(i.id) > 0 && i.name.toLowerCase().includes(lower))
      .slice(0, 40)
      .map((i) => ({
        kind: "component" as const,
        key: `c:${i.id}`,
        label: i.name,
        id: i.id,
        group: "Components" as const,
      }));

    const byGroup = new Map<string, Array<(typeof cmds)[0] | (typeof comps)[0]>>();
    for (const item of [...cmds, ...comps]) {
      const list = byGroup.get(item.group) ?? [];
      list.push(item);
      byGroup.set(item.group, list);
    }

    const out: Item[] = [];
    const groups = [
      ...GROUP_ORDER.filter((g) => byGroup.has(g)),
      ...[...byGroup.keys()].filter((g) => !GROUP_ORDER.includes(g)),
    ];
    for (const g of groups) {
      const list = byGroup.get(g)!;
      out.push({ kind: "header", key: `h:${g}`, label: g });
      out.push(...list);
    }
    return out;
  }, [q, commands, store]);

  const selectable = flat.filter((i): i is Exclude<Item, { kind: "header" }> => i.kind !== "header");
  const clampedActive = Math.min(active, Math.max(0, selectable.length - 1));
  const activeKey = selectable[clampedActive]?.key;

  const choose = (item: Item | undefined) => {
    if (!item || item.kind === "header") return;
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
          placeholder="Jump to a component or run a command…"
          value={q}
          spellCheck={false}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, selectable.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(selectable[clampedActive]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="rl-cmdk-list">
          {selectable.length === 0 ? (
            <div className="rl-empty rl-empty-compact">No matches.</div>
          ) : (
            flat.map((item) =>
              item.kind === "header" ? (
                <div key={item.key} className="rl-cmdk-group">
                  {item.label}
                </div>
              ) : (
                <div
                  key={item.key}
                  className={`rl-cmdk-item${item.key === activeKey ? " active" : ""}`}
                  onMouseEnter={() => {
                    const idx = selectable.findIndex((s) => s.key === item.key);
                    if (idx >= 0) setActive(idx);
                  }}
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
              ),
            )
          )}
        </div>
      </div>
    </div>
  );
}
