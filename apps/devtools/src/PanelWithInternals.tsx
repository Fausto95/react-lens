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

  if (workspace === "cascade") {
    return (
      <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 0 }}>
        <CascadePanel {...props} />
        <WorkspaceSwitch value={workspace} onChange={setWorkspace} />
      </div>
    );
  }

  return (
    <div
      className={`rl-root rl-redesign${props.embedded ? " rl-embedded" : ""}`}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 0,
        background: "var(--rl-bg)",
      }}
    >
      <div
        style={{
          height: 44,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
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

      <div style={{ height: "calc(100% - 44px)", minHeight: 0 }}>
        <ReactInternalsPanel
          store={props.store}
          selected={internalsSelected}
          onSelect={setInternalsSelected}
        />
      </div>

      <WorkspaceSwitch value={workspace} onChange={setWorkspace} />
    </div>
  );
}

function WorkspaceSwitch({
  value,
  onChange,
}: {
  value: "cascade" | "internals";
  onChange: (value: "cascade" | "internals") => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="React Lens workspace"
      style={{
        position: "absolute",
        top: 8,
        left: "50%",
        zIndex: 40,
        transform: "translateX(-50%)",
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 3,
        border: "1px solid var(--rl-border)",
        borderRadius: 8,
        background: "var(--rl-bg-raised)",
        boxShadow: "0 6px 18px rgba(0,0,0,.12)",
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
