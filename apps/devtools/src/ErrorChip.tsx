import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconAlert, IconNotice } from "@reactlens/icons";
import { clearErrors, lensErrors, subscribeErrors } from "./errors.js";

/**
 * What the error seam collected, as one toolbar chip.
 *
 * The panel used to fail invisibly: a swallowed exception left the timeline
 * frozen with no hint that anything had gone wrong, so the bug looked like a
 * hang. Nothing here is diagnostic UI — it is the acknowledgement that the
 * panel knows it broke.
 *
 * `lensErrors` is identity-stable, which is exactly what `useSyncExternalStore`
 * requires of a snapshot.
 */
export function ErrorChip() {
  const errors = useSyncExternalStore(subscribeErrors, lensErrors, lensErrors);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (menuRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (errors.length === 0) return null;
  const faults = errors.filter((e) => e.level === "error");
  const total = faults.reduce((sum, e) => sum + e.count, 0);
  // Notices are not faults, so they must not colour the chip red or be counted
  // as errors — but they still have to be visible, which is the whole point.
  const noticesOnly = total === 0;
  const count = noticesOnly ? errors.length : total;
  const label = noticesOnly
    ? `${count} React Lens notice${count === 1 ? "" : "s"}`
    : `${count} React Lens error${count === 1 ? "" : "s"}`;

  return (
    <span className="rl-menu-anchor">
      <button
        ref={anchorRef}
        type="button"
        className={`rl-icon-btn rl-error-chip${noticesOnly ? " notice" : ""}`}
        title={
          noticesOnly
            ? "React Lens has something to report — click for details"
            : "React Lens hit errors — click for details"
        }
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {noticesOnly ? <IconNotice size={14} /> : <IconAlert size={14} />}
        <span className={`rl-icon-pastille${noticesOnly ? "" : " severe"}`}>{count}</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="rl-menu"
          role="dialog"
          aria-label={noticesOnly ? "React Lens notices" : "React Lens errors"}
        >
          <div className="rl-menu-head">
            {noticesOnly ? "Notices" : "Errors"}
            <button
              type="button"
              className="rl-menu-head-action"
              onClick={() => {
                clearErrors();
                setOpen(false);
              }}
            >
              Clear
            </button>
          </div>
          <ul className="rl-error-list">
            {errors.map((e) => (
              <li key={`${e.scope}:${e.message}`} className={e.level}>
                <span className="scope">{e.scope}</span> {e.message}
                {e.count > 1 && <span className="count"> ×{e.count}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
