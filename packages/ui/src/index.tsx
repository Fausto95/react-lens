/**
 * Shared keyboard-first UI primitives for the panel. Presentational only — no
 * feature logic, tokens live in the consumer's theme.css (DESIGN §110).
 */
import { useState, type ReactNode } from "react";

export type BadgeTone =
  | "render"
  | "warn"
  | "suspicious"
  | "healthy"
  | "severe"
  | "dim";

export function Badge({ tone = "dim", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`rl-badge ${tone}`}>{children}</span>;
}

/** Collapsible titled section with an optional count. */
export function Section({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="rl-sec">
      <button className="rl-sec-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="rl-sec-caret">{open ? "▾" : "▸"}</span>
        <span className="rl-sec-title">{title}</span>
        {count !== undefined && count > 0 && <span className="rl-sec-count">{count}</span>}
      </button>
      {open && <div className="rl-sec-body">{children}</div>}
    </div>
  );
}
