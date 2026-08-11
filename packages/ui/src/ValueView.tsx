import { useState, useEffect } from "react";
import type { SerializedValue } from "@reactlens/protocol";
import { formatValue } from "./format.js";

type Path = Array<string | number>;
export type EditFn = (path: Path, value: string | number | boolean) => void;

/**
 * Recursive value explorer. Objects/arrays/maps/sets expand to show their
 * entries; primitives render inline and, when an `edit` callback is supplied,
 * become editable (text/number input, boolean toggle) that writes back to the
 * running app. Depth-limited values (beyond the serializer's budget) show a
 * marker rather than pretending to be leaves.
 */
export function ValueView({
  value,
  path = [],
  edit,
  depth = 0,
}: {
  value: SerializedValue;
  path?: Path;
  edit?: EditFn;
  depth?: number;
}) {
  switch (value.k) {
    case "primitive":
      return <Primitive value={value} path={path} edit={edit} />;
    case "object":
    case "array":
    case "map":
    case "set":
      return <Container value={value} path={path} edit={edit} depth={depth} />;
    default:
      return <span className={`rl-val rl-t-${value.k}`}>{formatValue(value)}</span>;
  }
}

function Primitive({
  value,
  path,
  edit,
}: {
  value: Extract<SerializedValue, { k: "primitive" }>;
  path: Path;
  edit?: EditFn;
}) {
  if (!edit) {
    return <span className={`rl-val rl-t-${value.type}`}>{formatValue(value)}</span>;
  }
  if (value.type === "boolean") {
    return (
      <button
        className={`rl-edit-bool ${value.value ? "on" : "off"}`}
        onClick={() => edit(path, !(value.value as boolean))}
        title="Toggle"
      >
        {String(value.value)}
      </button>
    );
  }
  return <PrimitiveInput value={value} path={path} edit={edit} />;
}

function PrimitiveInput({
  value,
  path,
  edit,
}: {
  value: Extract<SerializedValue, { k: "primitive" }>;
  path: Path;
  edit: EditFn;
}) {
  const isNumber = value.type === "number";
  const [buffer, setBuffer] = useState(String(value.value));
  // Keep the input in sync when the app pushes a new value.
  useEffect(() => setBuffer(String(value.value)), [value.value]);

  const commit = () => {
    if (isNumber) {
      const n = Number(buffer);
      if (!Number.isNaN(n)) edit(path, n);
    } else {
      edit(path, buffer);
    }
  };

  return (
    <input
      className={`rl-edit-input rl-t-${value.type}`}
      value={buffer}
      inputMode={isNumber ? "decimal" : "text"}
      onChange={(e) => setBuffer(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setBuffer(String(value.value));
      }}
    />
  );
}

function Container({
  value,
  path,
  edit,
  depth,
}: {
  value: Extract<SerializedValue, { k: "object" | "array" | "map" | "set" }>;
  path: Path;
  edit?: EditFn;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  const entries = childEntries(value);
  const summary = containerSummary(value);

  if (entries === null) {
    // Beyond serialization depth — value exists but wasn't expanded.
    return <span className="rl-val rl-muted">{summary} …</span>;
  }

  return (
    <span className="rl-val-container">
      <button className="rl-val-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="rl-val-caret">{entries.length ? (open ? "▾" : "▸") : ""}</span>
        <span className="rl-val rl-muted">{summary}</span>
      </button>
      {open && entries.length > 0 && (
        <div className="rl-val-children">
          {entries.map(({ key, label, child }) => (
            <div className="rl-val-row" key={label}>
              <span className="rl-val-key">{label}</span>
              <ValueView value={child} path={[...path, key]} edit={edit} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

interface Entry {
  key: string | number;
  label: string;
  child: SerializedValue;
}

/** Returns entries to render, or null when the value was depth-limited. */
function childEntries(
  value: Extract<SerializedValue, { k: "object" | "array" | "map" | "set" }>,
): Entry[] | null {
  switch (value.k) {
    case "object":
      if (!value.entries) return null;
      return value.entries.map(([k, child]) => ({ key: k, label: k, child }));
    case "array":
      if (!value.items) return null;
      return value.items.map((child, i) => ({ key: i, label: String(i), child }));
    case "map":
      if (!value.entries) return null;
      return value.entries.map(([k, child], i) => ({
        key: i,
        label: formatValue(k),
        child,
      }));
    case "set":
      if (!value.values) return null;
      return value.values.map((child, i) => ({ key: i, label: String(i), child }));
  }
}

function containerSummary(
  value: Extract<SerializedValue, { k: "object" | "array" | "map" | "set" }>,
): string {
  switch (value.k) {
    case "object":
      return value.ctor ?? "{…}";
    case "array":
      return `Array(${value.length})`;
    case "map":
      return `Map(${value.size})`;
    case "set":
      return `Set(${value.size})`;
  }
}
