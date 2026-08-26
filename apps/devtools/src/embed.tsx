import {
  StrictMode,
  useState,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import type { ComponentId } from "@reactlens/protocol";
import { Panel } from "./Panel.js";
import type { LensRuntime } from "./runtime.js";
import { createHighlighter } from "./highlighter.js";
import { createRenderOverlay } from "./renderOverlay.js";
import { createInspectController } from "./inspectController.js";
import { configureComponentLocator } from "./sourceLocator.js";
import { loadPanelPrefs, savePanelPrefs, type DockPlacement } from "./panelPrefs.js";
import { IconDockBottom, IconDockSide, IconPanel } from "@reactlens/icons";

const WAVE_MAX_GROUPS = 300;
const WAVE_MAX_NODES = 400;
const WAVE_MAX_MS = 1600;

/** Match the site's mobile breakpoint — dock starts hidden on narrow viewports. */
const EMBED_VISIBLE_MQ = "(min-width: 901px)";

function initialEmbedVisible(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(EMBED_VISIBLE_MQ).matches;
}

function EmbeddedPanel({
  runtime,
  host,
  initiallyVisible,
}: {
  runtime: LensRuntime;
  host: HTMLElement;
  initiallyVisible: boolean;
}) {
  const [visible, setVisible] = useState(initiallyVisible);
  const [dock, setDock] = useState<DockPlacement>(() => loadPanelPrefs().dockPlacement);
  const [overlayOn, setOverlayOn] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [pickedId, setPickedId] = useState<ComponentId | null>(null);
  const highlighter = useMemo(() => createHighlighter(), []);
  const overlay = useMemo(() => createRenderOverlay(runtime), [runtime]);
  const waveTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const inspect = useMemo(
    () =>
      createInspectController({
        runtime,
        highlighter,
        // Sticky pick: keep inspect active so double-click text edit still works.
        onPick: (pick) => setPickedId(pick.componentId),
        // Controller owns the mode; the button state follows it, so Escape
        // and window blur un-light the crosshair too.
        onStateChange: setInspecting,
        ignoreRoot: () => host,
      }),
    [runtime, highlighter, host],
  );

  // Same runtime, same page: locating is a direct call (the extension proxies
  // this over its port instead).
  useEffect(() => {
    configureComponentLocator(async (id) => runtime.locateComponent(id) ?? null);
    return () => configureComponentLocator(undefined);
  }, [runtime]);

  useEffect(() => () => highlighter.dispose(), [highlighter]);
  useEffect(() => () => overlay.dispose(), [overlay]);
  useEffect(() => () => inspect.dispose(), [inspect]);

  useLayoutEffect(() => {
    document.documentElement.dataset.rlPanel = visible ? "open" : "hidden";
    document.documentElement.dataset.rlDock = dock;
  }, [visible, dock]);

  useLayoutEffect(() => {
    if (!visible) {
      document.documentElement.style.removeProperty("--rl-embed-size");
      return;
    }
    const apply = () => {
      const panel = host.querySelector<HTMLElement>(".rl-embedded");
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const size = dock === "bottom" ? rect.height : rect.width;
      if (size > 0) {
        document.documentElement.style.setProperty("--rl-embed-size", `${Math.round(size)}px`);
      }
    };
    apply();
    const panel = host.querySelector<HTMLElement>(".rl-embedded");
    const observer = new ResizeObserver(apply);
    if (panel) observer.observe(panel);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [visible, dock, host]);

  const setPlacement = (next: DockPlacement) => {
    setDock(next);
    savePanelPrefs({ dockPlacement: next });
  };

  const cancelWave = useCallback(() => {
    for (const t of waveTimers.current) clearTimeout(t);
    waveTimers.current = [];
    highlighter.hide();
  }, [highlighter]);
  const replayWave = (ids: ComponentId[]) => {
    cancelWave();
    const capped = ids.slice(0, WAVE_MAX_GROUPS);
    const groups = capped.map((id) => runtime.domNodesOf(id)).filter((nodes) => nodes.length > 0);
    if (groups.length === 0) return;
    const step = Math.min(140, WAVE_MAX_MS / Math.max(1, groups.length));
    const acc: Node[] = [];
    acc.push(...groups[0]!);
    highlighter.show(acc);
    groups.forEach((nodes, i) => {
      if (i === 0) return;
      waveTimers.current.push(
        setTimeout(() => {
          acc.push(...nodes);
          if (acc.length > WAVE_MAX_NODES) acc.splice(0, acc.length - WAVE_MAX_NODES);
          highlighter.show(acc);
        }, i * step),
      );
    });
    waveTimers.current.push(setTimeout(cancelWave, groups.length * step + 800));
  };
  useEffect(() => () => cancelWave(), [cancelWave]);

  const edit = useMemo(
    () =>
      runtime.canEditValues()
        ? {
            setProp: (id: ComponentId, path: Array<string | number>, value: unknown) =>
              runtime.setProp(id, path, value),
            setHookState: (
              id: ComponentId,
              hookIndex: number,
              path: Array<string | number>,
              value: unknown,
            ) => runtime.setHookState(id, hookIndex, path, value),
          }
        : undefined,
    [runtime],
  );

  const onToggleInspect = () => {
    if (inspect.isActive()) inspect.stop();
    else inspect.start();
  };

  return (
    <>
      <div
        className={`rl-embed-shell${visible ? "" : " rl-embed-shell-hidden"}`}
        aria-hidden={!visible}
      >
        <Panel
          store={runtime.store}
          causality={runtime.causality}
          recording
          embedded
          embedDock={dock}
          overlayEnabled={overlayOn}
          inspecting={inspecting}
          onToggleInspect={onToggleInspect}
          selectComponent={pickedId}
          onSelectConsumed={() => setPickedId(null)}
          onToggleOverlay={() => {
            if (overlayOn) overlay.disable();
            else overlay.enable();
            setOverlayOn((v) => !v);
          }}
          onReplayCommit={replayWave}
          timeTravel={runtime.timeTravel}
          {...(edit ? { edit } : {})}
          onHighlight={(id: ComponentId | null, opts?: { reveal?: boolean }) => {
            if (id === null) {
              if (waveTimers.current.length > 0) return;
              highlighter.hide();
              return;
            }
            const nodes = runtime.domNodesOf(id);
            if (opts?.reveal) highlighter.reveal(nodes);
            else highlighter.show(nodes);
          }}
        />
      </div>
      <EmbedChrome
        visible={visible}
        dock={dock}
        onToggle={() => setVisible((value) => !value)}
        onDock={setPlacement}
      />
    </>
  );
}

function EmbedChrome({
  visible,
  dock,
  onToggle,
  onDock,
}: {
  visible: boolean;
  dock: DockPlacement;
  onToggle: () => void;
  onDock: (next: DockPlacement) => void;
}) {
  const [slot, setSlot] = useState<Element | null>(null);

  useEffect(() => {
    const found = document.querySelector("[data-rl-embed-controls]");
    if (found) {
      setSlot(found);
      return;
    }
    const observer = new MutationObserver(() => {
      const el = document.querySelector("[data-rl-embed-controls]");
      if (!el) return;
      setSlot(el);
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const inNav = slot != null;
  const chrome = (
    <div className={`rl-embed-controls${inNav ? " is-nav" : ""}`}>
      <div className="rl-embed-dock" role="group" aria-label="DevTools dock">
        <button
          type="button"
          className={dock === "side" ? "is-on" : undefined}
          aria-pressed={dock === "side"}
          aria-label="Dock DevTools on the side"
          title="Dock on the side"
          onClick={() => onDock("side")}
        >
          <IconDockSide size={16} />
        </button>
        <button
          type="button"
          className={dock === "bottom" ? "is-on" : undefined}
          aria-pressed={dock === "bottom"}
          aria-label="Dock DevTools at the bottom"
          title="Dock at the bottom"
          onClick={() => onDock("bottom")}
        >
          <IconDockBottom size={16} />
        </button>
      </div>
      <button
        type="button"
        className="rl-embed-toggle"
        aria-expanded={visible}
        aria-label={visible ? "Hide DevTools" : "Show DevTools"}
        title={visible ? "Hide DevTools" : "Show DevTools"}
        onClick={onToggle}
      >
        <IconPanel size={16} />
      </button>
    </div>
  );

  if (slot) return createPortal(chrome, slot);
  return chrome;
}

/**
 * Mount the panel beside (or under) the host app. Used by the playground in
 * dev mode so the whole pipeline (instrumentation → trace store → causality →
 * UI) is exercised without the extension. The panel mounts on a detached React
 * root so it never appears in the inspected app's own fiber tree. Body becomes
 * a flex row (or column) so the dock sits beside the app and the app column
 * shrinks — container queries then see the remaining width.
 */
export function mountEmbedded(runtime: LensRuntime): () => void {
  const host = document.createElement("div");
  host.id = "react-lens-overlay";
  document.body.appendChild(host);
  runtime.ignoreContainer(host);
  const initiallyVisible = initialEmbedVisible();
  const placement = loadPanelPrefs().dockPlacement;
  document.documentElement.dataset.rlPanel = initiallyVisible ? "open" : "hidden";
  document.documentElement.dataset.rlDock = placement;
  const root = createRoot(host);
  root.render(
    <StrictMode>
      <EmbeddedPanel runtime={runtime} host={host} initiallyVisible={initiallyVisible} />
    </StrictMode>,
  );
  return () => {
    root.unmount();
    host.remove();
    delete document.documentElement.dataset.rlPanel;
    delete document.documentElement.dataset.rlDock;
    document.documentElement.style.removeProperty("--rl-embed-size");
  };
}
