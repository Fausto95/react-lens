import { createStoreAdapter, registerStores } from "@reactlens/adapters";
import { useEffect, useState } from "react";
import { createExternalStore } from "../lib/external-store.js";

export const APPEARANCE_MODES = ["system", "light", "dark"] as const;
export type AppearanceMode = (typeof APPEARANCE_MODES)[number];
export type Scheme = "light" | "dark";
export type Density = "comfortable" | "compact";

type ChromeState = {
  mode: AppearanceMode;
  density: Density;
  sidebarCollapsed: boolean;
};

export const appearanceStore = createExternalStore<ChromeState>({
  mode: "system",
  density: "comfortable",
  sidebarCollapsed: false,
});

if (import.meta.env.DEV) {
  registerStores(
    createStoreAdapter<ChromeState>({
      id: "appearance",
      get: appearanceStore.getSnapshot,
      set: (snapshot) => appearanceStore.setState(snapshot),
    }),
  );
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveScheme(mode: AppearanceMode, systemDark: boolean): Scheme {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

export function useAppearance() {
  const chrome = appearanceStore.useStore();
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const scheme = resolveScheme(chrome.mode, systemDark);

  return {
    ...chrome,
    scheme,
    setMode: (mode: AppearanceMode) => appearanceStore.setState((s) => ({ ...s, mode })),
    setDensity: (density: Density) => appearanceStore.setState((s) => ({ ...s, density })),
    toggleSidebar: () =>
      appearanceStore.setState((s) => ({ ...s, sidebarCollapsed: !s.sidebarCollapsed })),
  };
}
