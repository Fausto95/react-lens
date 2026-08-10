import type { SerializedValue } from "@react-lens/protocol";
import { formatValue } from "@react-lens/ui";

// DiffLines now lives in @react-lens/ui; re-export for the tabs that use it.
export { DiffLines } from "@react-lens/ui";

/** A labelled value row with an optional status pill (props/state/hooks). */
export function ValueRow({
  name,
  value,
  status,
}: {
  name: string;
  value: SerializedValue | undefined;
  status?: string;
}) {
  return (
    <div className="rl-kv">
      <span className="rl-kv-key">{name}</span>
      <span className="rl-kv-val">{formatValue(value)}</span>
      {status && <span className={`rl-badge ${statusClass(status)}`}>{status}</span>}
    </div>
  );
}

function statusClass(status: string): string {
  if (status === "changed") return "warn";
  if (status === "ref") return "suspicious";
  if (status === "fn") return "suspicious";
  return "dim";
}

export function EmptyTab({ children }: { children: React.ReactNode }) {
  return <div className="rl-empty">{children}</div>;
}
