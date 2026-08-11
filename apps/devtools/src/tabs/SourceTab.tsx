import { useEffect, useState } from "react";
import type { ComponentInstance, SourceLocation } from "@reactlens/protocol";
import { definitionLine } from "@reactlens/diagnostics";
import { IconCopy } from "@reactlens/icons";
import { shortSource } from "@reactlens/ui";
import type { InspectorContext } from "../Inspector.js";
import { sourceResolver as resolver } from "../sourceResolver.js";
import { openResolvedInEditor } from "../openInEditor.js";
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
  const location = `${shortSource(shown.file)}:${line}`;
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
        <div className="rl-source-sub">compiled: {shortSource(compiled.file)}:{compiled.line}</div>
      )}
      <div className="rl-actions">
        <button
          className="rl-btn"
          onClick={() =>
            openResolvedInEditor(compiled, { file: shown.file, line, column: shown.column ?? 1 })
          }
          title="Open in editor (Cursor / VS Code)"
        >
          Open in editor
        </button>
        <CopyButton label="Copy line" value={location} />
        <CopyButton label="Copy path" value={shown.file} />
      </div>
    </div>
  );
}

/** Labeled copy action with transient confirmation — no icon guessing. */
function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="rl-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title={value}
    >
      <IconCopy size={12} /> {copied ? "Copied" : label}
    </button>
  );
}
