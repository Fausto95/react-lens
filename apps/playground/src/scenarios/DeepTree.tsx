import { Section } from "./ui.js";

/** A component nested many levels deep — tests tree depth + focus. */
export function DeepTree() {
  return (
    <Section
      title="Deep Tree"
      hint="A component nested 14 levels deep — test tree depth and focus."
    >
      <Nested depth={14} />
    </Section>
  );
}

function Nested({ depth }: { depth: number }) {
  if (depth === 0) return <span style={{ color: "#5f6878" }}>leaf</span>;
  return (
    <div style={{ paddingLeft: 8, borderLeft: "1px solid #eef0f3" }}>
      <span style={{ fontSize: 12, color: "#a0a6b2" }}>level {depth}</span>
      <Nested depth={depth - 1} />
    </div>
  );
}
