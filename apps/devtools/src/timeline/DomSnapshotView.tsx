import { useState } from "react";
import type { DOMNodeSnapshot, DOMSnapshot } from "@react-lens/protocol";
import { timeAxis } from "@react-lens/ui";

const MAX_RENDERED_NODES = 400;

/**
 * Offline playback: the page's captured DOM at the cursor, as a structural
 * tree (deliberately not a pixel reconstruction). Shown for imported sessions
 * where real state restoration has no live page to write to.
 */
export function DomSnapshotView({ dom, atOffsetMs }: { dom: DOMSnapshot; atOffsetMs: number }) {
  const [open, setOpen] = useState(true);
  let budget = MAX_RENDERED_NODES;
  const spend = () => budget-- > 0;
  return (
    <div className="rl-tl-domsnap">
      <button className="rl-tl-domsnap-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="rl-tl-domsnap-caret">{open ? "▾" : "▸"}</span>
        Page snapshot · {timeAxis(atOffsetMs)}
        <span className="rl-tl-domsnap-hint">imported session — structural DOM at the playhead</span>
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
      </div>
      {node.children?.map((child, i) => (
        <DomNode key={i} node={child} depth={depth + 1} spend={spend} />
      ))}
    </>
  );
}
