import { useState } from "react";

/** One-time hint that the page is inspecting itself. */
export function Coachmark() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="coach" role="note">
      <span className="pulse" />
      <span>
        This site is inspecting itself — the panel on the right is <strong>React Lens</strong>,
        running on this page. Open the tree and select any section.
      </span>
      <button className="x" aria-label="Dismiss" onClick={() => setOpen(false)}>
        ×
      </button>
    </div>
  );
}
