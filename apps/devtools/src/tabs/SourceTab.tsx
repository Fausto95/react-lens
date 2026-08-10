import type { ComponentInstance } from "@react-lens/protocol";
import type { InspectorContext } from "../Inspector.js";
import { EmptyTab } from "./shared.js";

/**
 * Source location + copy actions. A full source preview needs source maps
 * (tracked as a follow-up); React 19 often omits `_debugSource`, so the
 * location may be unavailable until that lands.
 */
export function SourceTab({ inst }: { inst: ComponentInstance; ctx: InspectorContext }) {
  const source = inst.source;
  if (!source) {
    return (
      <EmptyTab>
        No source location. React 19 omits <code>_debugSource</code> in most builds — a source-map
        path is a planned follow-up.
      </EmptyTab>
    );
  }

  const location = `${source.file}:${source.line}:${source.column}`;

  return (
    <div>
      <div className="rl-source-loc">{location}</div>
      <div className="rl-actions">
        <button className="rl-btn" onClick={() => copy(location)}>
          Copy location
        </button>
        <button className="rl-btn" onClick={() => copy(source.file)}>
          Copy file path
        </button>
      </div>
    </div>
  );
}

function copy(text: string): void {
  void navigator.clipboard?.writeText(text);
}
