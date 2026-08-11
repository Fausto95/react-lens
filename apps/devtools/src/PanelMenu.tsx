import { useEffect, useRef, useState } from "react";
import { THEME_PREFS, type ThemePref } from "./theme.js";
import { EDITOR_IDS, preferredEditor, setPreferredEditor, type EditorId } from "./openInEditor.js";

const THEME_LABELS: Record<ThemePref, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const EDITOR_LABELS: Record<EditorId, string> = {
  vscode: "VS Code",
  cursor: "Cursor",
  windsurf: "Windsurf",
  webstorm: "WebStorm",
};

/**
 * Panel preferences popover (header sliders icon): theme, render overlay,
 * editor for open-in-editor links, and the transport/protocol readout.
 */
export function PanelMenu({
  open,
  onClose,
  theme,
  onThemeChange,
  overlay,
  reveal,
  replayFollow,
  reading,
}: {
  open: boolean;
  onClose: () => void;
  theme: ThemePref;
  onThemeChange: (pref: ThemePref) => void;
  /** Render overlay control (embedded runtime only). */
  overlay?: { enabled: boolean; toggle: () => void } | undefined;
  /** Scroll the inspected page to the selected component when it's off-screen. */
  reveal?: { enabled: boolean; toggle: () => void } | undefined;
  /** Scroll the timeline to keep the playhead in view during replay. */
  replayFollow?: { enabled: boolean; toggle: () => void } | undefined;
  /** Where the panel reads from: embedded page or extension devtools. */
  reading: string;
}) {
  const [editor, setEditor] = useState<EditorId>(() => preferredEditor());
  const rootRef = useRef<HTMLDivElement>(null);

  // Light-dismiss: click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div ref={rootRef} className="rl-menu" role="dialog" aria-label="Panel settings">
      <div className="rl-menu-row">
        <span className="rl-menu-label">Theme</span>
        <div className="rl-menu-seg" role="radiogroup" aria-label="Theme">
          {THEME_PREFS.map((pref) => (
            <button
              key={pref}
              type="button"
              role="radio"
              aria-checked={theme === pref}
              className={`rl-menu-seg-btn${theme === pref ? " active" : ""}`}
              onClick={() => onThemeChange(pref)}
            >
              {THEME_LABELS[pref]}
            </button>
          ))}
        </div>
      </div>
      {overlay && (
        <div className="rl-menu-row">
          <span className="rl-menu-label">Render overlay</span>
          <button
            type="button"
            role="switch"
            aria-checked={overlay.enabled}
            aria-label="Render overlay"
            className={`rl-menu-switch${overlay.enabled ? " on" : ""}`}
            onClick={overlay.toggle}
          >
            <span className="rl-menu-switch-knob" />
          </button>
        </div>
      )}
      {reveal && (
        <div className="rl-menu-row">
          <span className="rl-menu-label" title="Selecting a component scrolls the page to it">
            Scroll to selection
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={reveal.enabled}
            aria-label="Scroll to selection"
            className={`rl-menu-switch${reveal.enabled ? " on" : ""}`}
            onClick={reveal.toggle}
          >
            <span className="rl-menu-switch-knob" />
          </button>
        </div>
      )}
      {replayFollow && (
        <div className="rl-menu-row">
          <span
            className="rl-menu-label"
            title="During replay, scroll the timeline so the playhead stays visible"
          >
            Replay scrolls timeline
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={replayFollow.enabled}
            aria-label="Replay scrolls timeline"
            className={`rl-menu-switch${replayFollow.enabled ? " on" : ""}`}
            onClick={replayFollow.toggle}
          >
            <span className="rl-menu-switch-knob" />
          </button>
        </div>
      )}
      <div className="rl-menu-row">
        <span className="rl-menu-label">Editor</span>
        <select
          className="rl-menu-select"
          value={editor}
          aria-label="Editor for open-in-editor links"
          onChange={(e) => {
            const next = e.target.value as EditorId;
            setEditor(next);
            setPreferredEditor(next);
          }}
        >
          {EDITOR_IDS.map((id) => (
            <option key={id} value={id}>
              {EDITOR_LABELS[id]}
            </option>
          ))}
        </select>
      </div>
      <div className="rl-menu-foot">
        reading <strong>{reading}</strong> · protocol v1
      </div>
    </div>
  );
}
