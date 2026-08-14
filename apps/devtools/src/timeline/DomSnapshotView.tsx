import { useState } from "react";
import type { DOMNodeSnapshot, DOMSnapshot } from "@reactlens/protocol";
import { timeAxis } from "@reactlens/ui";

const MAX_RENDERED_NODES = 400;
const STYLE_PREVIEW = ["display", "width", "height", "opacity", "color", "background-color", "transform"];

/**
 * Offline playback: the page's captured DOM at the cursor, including the
 * browser-resolved visual state when available. The visual layer is styling-
 * library agnostic: Tailwind, CSS Modules, CSS-in-JS and inline styles all
 * converge on the same computed CSS/layout representation here.
 */
export function DomSnapshotView({ dom, atOffsetMs }: { dom: DOMSnapshot; atOffsetMs: number }) {
  const [open, setOpen] = useState(true);
  let budget = MAX_RENDERED_NODES;
  const spend = () => budget-- > 0;
  return (
    <div className="rl-tl-domsnap">
      <button
        className="rl-tl-domsnap-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="rl-tl-domsnap-caret">{open ? "▾" : "▸"}</span>
        Page snapshot · {timeAxis(atOffsetMs)}
        <span className="rl-tl-domsnap-hint">
          imported session — DOM + resolved visual state at the playhead
        </span>
      </button>
      {open && (
        <div className="rl-tl-domsnap-tree">
          <DomNode node={dom.root} depth={0} spend={spend} />
          {budget <= 0 && <div className="rl-tl-domsnap-more">… truncated</div>}
        </div>
      )}
    </div>
  );
}

function DomNode({
  node,
  depth,
  spend,
}: {
  node: DOMNodeSnapshot;
  depth: number;
  spend: () => boolean;
}) {
  if (!spend()) return null;
  if (node.nodeName === "#text") {
    return (
      <div className="rl-tl-domsnap-text" style={{ paddingLeft: depth * 12 }}>
        “{node.text}”
      </div>
    );
  }
  const id = node.attributes?.["id"];
  const cls = node.attributes?.["class"];
  return (
    <>
      <div className="rl-tl-domsnap-node" style={{ paddingLeft: depth * 12 }}>
        <span className="rl-tl-domsnap-tag">{node.nodeName.toLowerCase()}</span>
        {id && <span className="rl-tl-domsnap-attr">#{id}</span>}
        {cls && <span className="rl-tl-domsnap-attr">.{cls.split(/\s+/).join(".")}</span>}
        {node.text && <span className="rl-tl-domsnap-inline">“{node.text}”</span>}
        <VisualPreview node={node} />
      </div>
      {node.children?.map((child, i) => (
        <DomNode key={i} node={child} depth={depth + 1} spend={spend} />
      ))}
    </>
  );
}

function VisualPreview({ node }: { node: DOMNodeSnapshot }) {
  const visual = node.visual;
  if (!visual) return null;

  const parts: string[] = [];
  const rect = visual.rect;
  if (rect) parts.push(`${rect.width}×${rect.height} @ ${rect.x},${rect.y}`);

  for (const property of STYLE_PREVIEW) {
    const value = visual.computedStyle?.[property];
    if (value) parts.push(`${property}: ${value}`);
  }

  const vars = Object.keys(visual.customProperties ?? {}).length;
  if (vars) parts.push(`${vars} CSS var${vars === 1 ? "" : "s"}`);
  if (!parts.length) return null;

  return (
    <span className="rl-tl-domsnap-inline" title={parts.join(" · ")}>
      {" "}· {parts.slice(0, 2).join(" · ")}
    </span>
  );
}
