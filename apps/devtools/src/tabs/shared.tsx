import type { SerializedValue } from "@react-lens/protocol";
import type { DiffResult } from "@react-lens/diff-engine";
import { formatValue } from "../format.js";

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

export function DiffLines({ result }: { result: DiffResult }) {
  const changes = result.changes.filter((c) => c.kind !== "UNCHANGED" && c.path.length > 0);
  if (changes.length === 0) return <div className="rl-diff rl-muted">No value changes.</div>;
  return (
    <div className="rl-diff">
      {changes.map((c, i) => (
        <div className={`rl-diff-line rl-chg-${c.kind}`} key={i}>
          <span className="rl-path">{c.path.join(".") || "(root)"}</span>
          <span>
            {formatValue(c.before)} → {formatValue(c.after)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function EmptyTab({ children }: { children: React.ReactNode }) {
  return <div className="rl-empty">{children}</div>;
}
