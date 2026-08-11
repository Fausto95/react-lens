import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveTheme, applyThemePref } from "./theme.js";
import { loadPanelPrefs, savePanelPrefs } from "./panelPrefs.js";

afterEach(() => {
  delete document.documentElement.dataset.rlTheme;
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("resolveTheme", () => {
  it("maps explicit prefs directly and system to the OS preference", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
  });
});

describe("applyThemePref", () => {
  function stubMatchMedia(prefersLight: boolean) {
    const listeners: Array<(e: { matches: boolean }) => void> = [];
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("light") ? prefersLight : !prefersLight,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb),
      removeEventListener: () => {},
    }));
    return listeners;
  }

  it("stamps the resolved theme on the document root", () => {
    stubMatchMedia(false);
    const cleanup = applyThemePref("light");
    expect(document.documentElement.dataset.rlTheme).toBe("light");
    cleanup();
  });

  it("system pref follows OS changes live", () => {
    const listeners = stubMatchMedia(false);
    const cleanup = applyThemePref("system");
    expect(document.documentElement.dataset.rlTheme).toBe("dark");
    for (const cb of listeners) cb({ matches: true });
    expect(document.documentElement.dataset.rlTheme).toBe("light");
    cleanup();
  });
});

describe("panel prefs — theme", () => {
  it("persists the theme pref and rejects junk", () => {
    savePanelPrefs({ theme: "light" });
    expect(loadPanelPrefs().theme).toBe("light");
    localStorage.setItem(
      "react-lens/panel-prefs",
      JSON.stringify({ theme: "hotdog" }),
    );
    expect(loadPanelPrefs().theme).toBe("dark");
  });
});
