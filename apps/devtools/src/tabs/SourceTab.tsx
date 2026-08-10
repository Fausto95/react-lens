import { useEffect, useState } from "react";
import type { ComponentInstance, SourceLocation } from "@react-lens/protocol";
import { createSourceResolver } from "@react-lens/source-maps";
import type { InspectorContext } from "../Inspector.js";
import { EmptyTab } from "./shared.js";

// One resolver for the panel — caches maps across selections.
const resolver = createSourceResolver();

/**
 * Source location + copy actions. React 19 exposes only a compiled creation
 * site (via _debugStack); we resolve it to original coordinates through the
 * module's source map when available (embedded, same-origin).
 */
export function SourceTab({ inst }: { inst: ComponentInstance; ctx: InspectorContext }) {
  const compiled = inst.source;
  const [original, setOriginal] = useState<SourceLocation | null>(null);
  const [state, setState] = useState<"idle" | "resolving" | "done">("idle");

  useEffect(() => {
    if (!compiled) return;
    let alive = true;
    setState("resolving");
    setOriginal(null);
    resolver
      .resolve(compiled)
      .then((r) => alive && (setOriginal(r), setState("done")))
      .catch(() => alive && setState("done"));
    return () => {
      alive = false;
    };
  }, [compiled?.file, compiled?.line, compiled?.column]);

  if (!compiled) {
    return (
      <EmptyTab>
        No source location. React 19 exposes only a compiled creation site; none was captured here.
      </EmptyTab>
    );
  }

  const shown = original ?? compiled;
  const location = `${shown.file}:${shown.line}:${shown.column}`;

  return (
    <div>
      <div className="rl-source-loc">
        {location}
        {original ? (
          <span className="rl-badge healthy" style={{ marginLeft: 8 }}>
            original
          </span>
        ) : state === "resolving" ? (
          <span className="rl-badge dim" style={{ marginLeft: 8 }}>
            resolving…
          </span>
        ) : (
          <span className="rl-badge dim" style={{ marginLeft: 8 }}>
            compiled
          </span>
        )}
      </div>
      {original && (
        <div className="rl-source-sub">compiled: {compiled.file}:{compiled.line}</div>
      )}
      <div className="rl-actions">
        <button className="rl-btn" onClick={() => copy(location)}>
          Copy location
        </button>
        <button className="rl-btn" onClick={() => copy(shown.file)}>
          Copy file path
        </button>
      </div>
    </div>
  );
}

function copy(text: string): void {
  void navigator.clipboard?.writeText(text);
}
