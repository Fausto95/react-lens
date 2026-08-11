import { useState } from "react";
import type { DOMNodeSnapshot } from "@reactlens/protocol";
import { IconCrosshair } from "@reactlens/icons";
import type { InspectorContext } from "../Inspector.js";
import { EmptyTab } from "./shared.js";

/**
 * Renders the component's captured DOM output as a compact, collapsible markup
 * tree (from the active render's snapshot). Only the component's first host
 * subtree is captured, which covers the common case.
 */
export function DomTab({ ctx }: { ctx: InspectorContext }) {
  const { snapshot, highlight, componentId } = ctx;
  if (!snapshot?.dom) return <EmptyTab>No DOM captured for this render.</EmptyTab>;

  return (
    <div>
      {highlight && (
        <button
          className="rl-icon-btn rl-dom-hl"
          onMouseEnter={() => highlight(componentId)}
          onMouseLeave={() => highlight(null)}
          onFocus={() => highlight(componentId)}
          onBlur={() => highlight(null)}
          title="Highlight on page"
          aria-label="Highlight on page"
        >
          <IconCrosshair size={14} />
        </button>
      )}
      <div className="rl-dom">
        <DomNode node={snapshot.dom.root} depth={0} />
      </div>
    </div>
  );
}

function DomNode({ node, depth }: { node: DOMNodeSnapshot; depth: number }) {
  const [open, setOpen] = useState(depth < 3);

  if (node.nodeName === "#text") {
    return <div className="rl-dom-line rl-dom-text">{node.text}</div>;
  }

  const tag = node.nodeName.toLowerCase();
  const attrs = node.attributes ? Object.entries(node.attributes) : [];
  const children = node.children ?? [];
  const inlineText = !children.length && node.text ? node.text : null;

  if (!children.length) {
    return (
      <div className="rl-dom-line">
        <span className="rl-dom-punct">&lt;</span>
        <span className="rl-dom-tag">{tag}</span>
        <Attrs attrs={attrs} />
        <span className="rl-dom-punct">&gt;</span>
        {inlineText && <span className="rl-dom-textinline">{inlineText}</span>}
        <span className="rl-dom-punct">
          &lt;/{tag}&gt;
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="rl-dom-line rl-dom-open" onClick={() => setOpen((o) => !o)}>
        <span className="rl-dom-caret">{open ? "▾" : "▸"}</span>
        <span className="rl-dom-punct">&lt;</span>
        <span className="rl-dom-tag">{tag}</span>
        <Attrs attrs={attrs} />
        <span className="rl-dom-punct">&gt;</span>
        {!open && <span className="rl-dom-ellipsis">…&lt;/{tag}&gt;</span>}
      </div>
      {open && (
        <>
          <div className="rl-dom-children">
            {children.map((child, i) => (
              <DomNode key={i} node={child} depth={depth + 1} />
            ))}
          </div>
          <div className="rl-dom-line">
            <span className="rl-dom-punct">&lt;/{tag}&gt;</span>
          </div>
        </>
      )}
    </div>
  );
}

const MAX_ATTR_VALUE = 48;

function Attrs({ attrs }: { attrs: Array<[string, string]> }) {
  return (
    <>
      {attrs.map(([name, value]) => {
        const clipped = value.length > MAX_ATTR_VALUE ? value.slice(0, MAX_ATTR_VALUE) + "…" : value;
        return (
          <span key={name} className="rl-dom-attr">
            {" "}
            <span className="rl-dom-attr-name">{name}</span>
            <span className="rl-dom-punct">=</span>
            <span className="rl-dom-attr-val" title={value}>
              "{clipped}"
            </span>
          </span>
        );
      })}
    </>
  );
}
