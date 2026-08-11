import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { openInEditor, preferredEditor } from "./openInEditor.js";

function iframes(): HTMLIFrameElement[] {
  return [...document.querySelectorAll("iframe")];
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  for (const f of iframes()) f.remove();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("openInEditor", () => {
  it("fires exactly one protocol navigation — a second one would cancel the browser's open-app prompt", () => {
    openInEditor("/repo/src/App.tsx", 42, 7);
    vi.advanceTimersByTime(500); // past the old 80ms second-scheme poke
    expect(iframes()).toHaveLength(1);
    expect(iframes()[0]!.src).toBe("vscode://file//repo/src/App.tsx:42:7");
  });

  it("keeps the iframe alive long enough for the user to answer the prompt", () => {
    openInEditor("/repo/src/App.tsx", 1);
    vi.advanceTimersByTime(5_000);
    expect(iframes()).toHaveLength(1); // the old 1.5s removal dismissed the dialog
    vi.advanceTimersByTime(60_000);
    expect(iframes()).toHaveLength(0); // but it does get cleaned up eventually
  });

  it("honors the persisted editor preference", () => {
    localStorage.setItem("react-lens:editor", "cursor");
    expect(preferredEditor()).toBe("cursor");
    openInEditor("/repo/src/App.tsx", 3, 1);
    expect(iframes()[0]!.src).toBe("cursor://file//repo/src/App.tsx:3:1");
  });

  it("falls back to vscode for unknown preference values", () => {
    localStorage.setItem("react-lens:editor", "emacs-butterflies");
    expect(preferredEditor()).toBe("vscode");
  });

  it("still refuses URLs and empty paths", () => {
    expect(openInEditor("https://app.example/x.js", 1)).toBe(false);
    expect(openInEditor("  ", 1)).toBe(false);
    expect(iframes()).toHaveLength(0);
  });
});
