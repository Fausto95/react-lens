import { useState } from "react";
import type { ComponentId } from "@reactlens/protocol";
import type { PanelProps } from "./Panel.js";
import { Panel as CascadePanel } from "./Panel.js";
import { ReactInternalsPanel } from "./react-internals/ReactInternalsPanel.js";

export {
  configureSourceFetcher,
  getSourceResolver,
  configureComponentLocator,
  configureSourceRevealer,
} from "./Panel.js";
export type {
  ComponentLocator,
  LocatedSource,
  EditApi,
  TimeTravelApi,
  PanelProps,
} from "./Panel.js";

export function Panel(props: PanelProps) {
  const [workspace, setWorkspace] = useState<"cascade" | "internals">("cascade");
  const [internalsSelected, setInternalsSelected] = useState<ComponentId | null>(null);

  return (
    <>
      {workspace === "cascade" ? (
        // Important: CascadePanel must remain the layout root. Its `.rl-root`
        // contract is fixed/inset and is relied on by both the extension panel
        // and the embedded dock. Wrapping it in a percentage-sized container
        // collapses the mount in hosts that intentionally do not size #root.
        <CascadePanel {...props} />
      ) : (
        <div
          className={`rl-root rl-redesign${props.embedded ? " rl-embedded" : ""}`}
          style={{
            display: "flex",
            flexDirection: "column",
            width: props.embedded ? undefined : "100%",
            height: "100%",
            minWidth: 0,
            minHeight: 0,
            background: "var(--rl-bg)",
          }}
        >
          <div
            style={{
              height: 44,
              flex: "0 0 44px",
              display: "flex",
              alignItems: "center",
              padding: "0 14px",
              borderBottom: "1px solid var(--rl-border)",
              background: "var(--rl-bg-raised)",
            }}
          >
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 650 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 16,
                  height: 16,
                  border: "2px solid var(--rl-interaction)",
                  borderRadius: "50%",
                  display: "inline-block",
                }}
              />
              React Lens
            </div>
            <span
              style={{
                marginLeft: 12,
                color: "var(--rl-text-dim)",
                fontFamily: "var(--rl-mono)",
                fontSize: 11,
              }}
            >
              React runtime · live trace
            </span>
          </div>

          <div style={{ flex: "1 1 auto", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <ReactInternalsPanel
              store={props.store}
              selected={internalsSelected}
              onSelect={setInternalsSelected}
            />
          </div>
        </div>
      )}

      <WorkspaceSwitch value={workspace} onChange={setWorkspace} embedded={props.embedded === true} />
    </>
  );
}

function WorkspaceSwitch({
  value,
  onChange,
  embedded,
}: {
  value: "cascade" | "internals";
  onChange: (value: "cascade" | "internals") => void;
  embedded: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="React Lens workspace"
      style={{
        position: "fixed",
        top: 8,
        // The embedded panel is right-docked; center the control inside that
        // dock rather than the inspected page viewport.
        left: embedded ? "auto" : "50%",
        right: embedded ? "min(34vw, 430px)" : "auto",
        zIndex: 2147483050,
        transform: embedded ? undefined : "translateX(-50%)",
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 3,
        border: "1px solid var(--rl-border)",
        borderRadius: 8,
        background: "var(--rl-bg-raised)",
        boxShadow: "0 6px 18px rgba(0,0,0,.12)",
        fontFamily: "var(--rl-font)",
      }}
    >
      <WorkspaceTab active={value === "cascade"} onClick={() => onChange("cascade")}>
        Cascade
      </WorkspaceTab>
      <WorkspaceTab active={value === "internals"} onClick={() => onChange("internals")}>
        React Internals
      </WorkspaceTab>
    </div>
  );
}

function WorkspaceTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        height: 26,
        padding: "0 10px",
        border: active ? "1px solid var(--rl-border-strong)" : "1px solid transparent",
        borderRadius: 6,
        background: active ? "var(--rl-bg-active)" : "transparent",
        color: active ? "var(--rl-text)" : "var(--rl-text-dim)",
        font: "600 11px/1 var(--rl-font)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
