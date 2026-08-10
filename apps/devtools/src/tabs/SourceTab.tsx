import { useEffect, useState } from "react";
import type { ComponentInstance, SourceLocation } from "@react-lens/protocol";
import { definitionLine } from "@react-lens/diagnostics";
import type { InspectorContext } from "../Inspector.js";
import { sourceResolver as resolver } from "../sourceResolver.js";
import { EmptyTab } from "./shared.js";

/**
 * Source location + copy actions. React 19 exposes only a compiled creation
 * site (via _debugStack); we resolve it to original coordinates through the
 * module's source map, and prefer the component's DEFINITION line (found in the
 * original source) when available.
 */
export function SourceTab({ inst }: { inst: ComponentInstance; ctx: InspectorContext }) {
  const compiled = inst.source;
  const [original, setOriginal] = useState<SourceLocation | null>(null);
  const [defLine, setDefLine] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "resolving" | "done">("idle");

  useEffect(() => {
    if (!compiled) return;
    let alive = true;
    setState("resolving");
    setOriginal(null);
    setDefLine(null);
    Promise.all([resolver.resolve(compiled), resolver.sourceContent(compiled.file)])
      .then(([loc, src]) => {
        if (!alive) return;
        setOriginal(loc);
        if (src) {
          const line = definitionLine(src.content, inst.name);
          if (line != null) setDefLine(line);
        }
        setState("done");
      })
      .catch(() => alive && setState("done"));
    return () => {
      alive = false;
    };
  }, [compiled?.file, compiled?.line, compiled?.column, inst.name]);

  if (!compiled) {
    return (
      <EmptyTab>
        No source location. React 19 exposes only a compiled creation site; none was captured here.
      </EmptyTab>
    );
  }

  // Prefer the definition line found in the original source; else the mapped
  // original location; else the raw compiled creation site.
  const shown = original ?? compiled;
  const line = defLine ?? shown.line;
  const location = `${shown.file}:${line}`;
  const kind = defLine != null ? "definition" : original ? "original" : "compiled";

  return (
    <div>
      <div className="rl-source-loc">
        {location}
        {state === "resolving" ? (
          <span className="rl-badge dim" style={{ marginLeft: 8 }}>
            resolving…
          </span>
        ) : (
          <span className={`rl-badge ${kind === "compiled" ? "dim" : "healthy"}`} style={{ marginLeft: 8 }}>
            {kind}
          </span>
        )}
      </div>
      {kind !== "compiled" && (
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
