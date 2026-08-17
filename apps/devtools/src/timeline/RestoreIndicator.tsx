import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconAlert, IconChevronDown, IconStore } from "@reactlens/icons";
import type {
  ComponentId,
  TimeTravelFailureReason,
  TimeTravelStoreFailureReason,
} from "@reactlens/protocol";

/**
 * Why a component could not follow the playhead. Written as consequence first,
 * cause second: the reader is looking at a screen that lies to them and wants
 * to know how much of it to trust.
 */
const REASON: Record<TimeTravelFailureReason, string> = {
  "no-history": "History no longer retained — this render aged out of the ring.",
  "no-fiber": "Unmounted since capture — the component is not on the page any more.",
  "shape-mismatch":
    "Hooks changed since capture (a hot reload); restoring by index would corrupt them.",
  "write-failed": "The renderer refused the write.",
};

const STORE_REASON: Record<TimeTravelStoreFailureReason, string> = {
  "no-snapshot": "No snapshot this far back — the store registered later, or its history aged out.",
  "snapshot-failed": "getSnapshot threw while taking the live baseline.",
  "apply-failed": "applySnapshot threw.",
};

export interface RestoreFailureItem {
  id: ComponentId;
  name: string;
  reason: TimeTravelFailureReason;
}

export interface RestoreStoreFailureItem {
  storeId: string;
  reason: TimeTravelStoreFailureReason;
}

/** Where the page's paint disagrees with what was captured at the cursor. */
export interface RestoreDomMismatch {
  count: number;
  examples: string[];
}

export interface RestoreIndicatorProps {
  /** Components restored. Never rendered as a number — see the chip's comment. */
  applied: number;
  failures: RestoreFailureItem[];
  storesApplied?: number;
  storeFailures?: RestoreStoreFailureItem[];
  domMismatch?: RestoreDomMismatch;
  onSelect?: (id: ComponentId) => void;
}

/**
 * Where the popover sits (viewport coordinates) and what it renders into, both
 * resolved from the chip when it opens — never by reading a ref during render.
 */
interface Anchor {
  top: number;
  right: number;
  target: HTMLElement;
}

/**
 * How faithfully the page is showing the past, while time travel drives it.
 *
 * Icon-led and numeric: a toolbar has no room for sentences, and "199 restored"
 * was the loudest thing on this one while being the least useful. Healthy is a
 * store glyph and the count of stores that followed; a failure is an alert glyph
 * and the count that did not. The sentence lives in the tooltip and the
 * accessible name, the explanation one click away.
 */
export function RestoreIndicator({
  applied,
  failures,
  storesApplied = 0,
  storeFailures = [],
  domMismatch,
  onSelect,
}: RestoreIndicatorProps) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const failedCount = failures.length + storeFailures.length;
  // A paint that disagrees with the capture is worth the same attention as a
  // refused write: in both cases the page is not showing the past.
  const partial = failedCount > 0 || domMismatch !== undefined;
  // Derived, not synchronised: a recovery hides the popover on the same render
  // that removes the failures, with no effect and no cascading state.
  const showMenu = anchor !== null && partial;

  useEffect(() => {
    if (!showMenu) return;
    const close = () => setAnchor(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (menuRef.current?.contains(t) || chipRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    // The toolbar wraps and the dock resizes; a stale anchor would leave the
    // popover pointing at nothing.
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
    };
  }, [showMenu]);

  const stores = storesApplied === 1 ? "1 store" : `${storesApplied} stores`;
  const alsoStores = storesApplied > 0 ? ` and ${stores}` : "";
  const components = `${applied} component${applied === 1 ? "" : "s"}`;
  const sentence = partial
    ? `${failureLabel(failures.length, storeFailures.length)} — ${components}${alsoStores} did`
    : `Every component's state follows the playhead${storesApplied > 0 ? `, and ${stores}` : ""}`;

  return (
    <span className="rl-menu-anchor">
      <button
        ref={chipRef}
        type="button"
        className={`rl-restore-chip${partial ? " partial" : ""}`}
        aria-label={partial ? `${sentence}; show details` : sentence}
        title={sentence}
        {...(partial ? { "aria-expanded": showMenu, "aria-haspopup": "dialog" as const } : {})}
        disabled={!partial}
        onClick={() => {
          if (anchor) {
            setAnchor(null);
            return;
          }
          const chip = chipRef.current;
          if (!chip) return;
          const rect = chip.getBoundingClientRect();
          setAnchor({
            top: rect.bottom + 6,
            right: rect.right,
            // The panel root, so the popover keeps the panel's theme variables:
            // they are declared on `.rl-root`, and a body-level portal would
            // render unthemed.
            target: chip.closest<HTMLElement>(".rl-root") ?? document.body,
          });
        }}
      >
        {/* Each glyph matches what its number means: stores that followed, or
            failures of any kind. The rewind glyph belongs to the toggle beside
            this chip, so reusing it here would read as a second toggle. */}
        {partial ? <IconAlert size={12} /> : <IconStore size={12} />}
        {(partial || storesApplied > 0) && failedCount + storesApplied > 0 && (
          <span className="rl-restore-chip-count">{partial ? failedCount : storesApplied}</span>
        )}
        {partial && <IconChevronDown size={10} />}
      </button>
      {showMenu &&
        // Portaled to the panel root: the cascade toolbar clips its overflow and
        // the graph canvas paints over it, so an in-place popover is both cut
        // off and buried. Fixed positioning from the chip's rect keeps it put.
        createPortal(
          <div
            ref={menuRef}
            className="rl-menu rl-restore-menu"
            role="dialog"
            aria-label="Restore failures"
            style={{ top: anchor.top, left: anchor.right }}
          >
            <div className="rl-menu-head">
              <span>
                {failedCount > 0 ? `${failedCount} didn't rewind` : "Page differs from the capture"}
                <span className="rl-restore-menu-ok">
                  {" · "}
                  {components}
                  {alsoStores} did
                </span>
              </span>
            </div>
            <div className="rl-restore-menu-list">
              {domMismatch && (
                <div className="rl-restore-row">
                  <span className="rl-restore-row-pip" />
                  <span className="rl-restore-row-body">
                    <span className="rl-restore-row-head">
                      <span className="rl-restore-row-name">
                        {domMismatch.count} {domMismatch.count === 1 ? "place" : "places"} differ
                      </span>
                      <span className="rl-restore-row-kind">paint</span>
                    </span>
                    <span className="rl-restore-row-why">
                      The page does not match the DOM captured here
                      {domMismatch.examples.length > 0
                        ? ` — ${domMismatch.examples.slice(0, 3).join(", ")}`
                        : ""}
                      .
                    </span>
                  </span>
                </div>
              )}
              {/* Stores first: one store explains more of the screen than any
                  single component, so it is the more useful thing to read. */}
              {storeFailures.map((f) => (
                <div key={`store:${f.storeId}`} className="rl-restore-row">
                  <span className="rl-restore-row-pip" />
                  <span className="rl-restore-row-body">
                    <span className="rl-restore-row-head">
                      <span className="rl-restore-row-name">{f.storeId}</span>
                      <span className="rl-restore-row-kind">store</span>
                    </span>
                    <span className="rl-restore-row-why">{STORE_REASON[f.reason]}</span>
                  </span>
                </div>
              ))}
              {failures.map((f) => (
                <button
                  key={`component:${f.id}`}
                  type="button"
                  className="rl-restore-row"
                  onClick={() => {
                    onSelect?.(f.id);
                    setAnchor(null);
                  }}
                  disabled={!onSelect}
                >
                  <span className="rl-restore-row-pip" />
                  <span className="rl-restore-row-body">
                    <span className="rl-restore-row-head">
                      <span className="rl-restore-row-name">{f.name}</span>
                      <span className="rl-restore-row-kind">component</span>
                    </span>
                    <span className="rl-restore-row-why">{REASON[f.reason]}</span>
                  </span>
                  {onSelect && <span className="rl-restore-row-go" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </div>,
          anchor.target,
        )}
    </span>
  );
}

/**
 * Name the kind that failed when only one kind did — "1 store didn't rewind"
 * tells the reader where to look, which a bare count does not.
 */
function failureLabel(components: number, stores: number): string {
  // Paint-only: every write landed, but the page still does not match.
  if (components === 0 && stores === 0) return "page differs";
  if (stores === 0) return `${components} component${components === 1 ? "" : "s"} didn't rewind`;
  if (components === 0) return `${stores} store${stores === 1 ? "" : "s"} didn't rewind`;
  return `${components + stores} didn't rewind`;
}
